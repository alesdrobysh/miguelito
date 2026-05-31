import fs from "fs";
import path from "path";
import type { Config } from "./infrastructure/config.js";
import { BuddyDb } from "./infrastructure/db.js";
import { listAvailableLanguages, loadLanguage } from "./languages/index.js";
import type { LanguageConfig } from "./languages/LanguageConfig.js";
import { OpenRouterProvider } from "./providers/OpenRouterProvider.js";
import { OllamaProvider } from "./providers/OllamaProvider.js";
import type { LLMProvider } from "./providers/interfaces.js";
import { PromptBuilder } from "./agent/PromptBuilder.js";
import { AgentRunner } from "./agent/AgentRunner.js";
import { DreamService } from "./services/DreamService.js";
import type { ChatMessage } from "./llm.js";

export interface RuntimeDeps {
  provider?: LLMProvider;
  evaluatorProvider?: LLMProvider;
}

export interface LanguageRuntime {
  lang: LanguageConfig;
  db: BuddyDb;
  sharedDb: BuddyDb;
  agentRunner: AgentRunner;
  dreamService: DreamService;
  dreamMemoryPath: string;
}

export function createProvider(config: Config): LLMProvider {
  if (config.provider === "ollama") {
    return new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      apiKey: config.ollamaApiKey || undefined,
    });
  }
  return new OpenRouterProvider({
    apiKey: config.openrouterApiKey,
    model: config.chatModel,
    baseUrl: config.openrouterBaseUrl,
  });
}

export function createEvaluatorProvider(config: Config): LLMProvider {
  if (config.provider === "ollama") {
    return new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      apiKey: config.ollamaApiKey || undefined,
    });
  }
  return new OpenRouterProvider({
    apiKey: config.openrouterApiKey,
    model: config.evaluatorModel,
    baseUrl: config.openrouterBaseUrl,
  });
}

const MODEL_HISTORY_LIMIT = 50;


function formatStart(_lang: LanguageConfig): string {
  return [
    "Hola — soy Miguelito, tu tutor de español.",
    "Para empezar, cuéntame en español, aunque sea con frases simples:",
    "1. ¿Por qué quieres practicar español?",
    "2. ¿Qué temas te interesan?",
    "3. ¿Cómo prefieres que te corrija: suave, normal o directo?",
    "",
    "Con eso adaptaré la conversación y recordaré lo útil para traerlo de vuelta suavemente.",
  ].join("\n");
}

function formatCommandRedirect(_lang: LanguageConfig): string {
  return "Escríbeme normalmente; yo recordaré lo útil y lo traeré de vuelta en la conversación.";
}

export class RuntimeManager {
  private runtimes = new Map<string, LanguageRuntime>();

  constructor(private config: Config, private provider: LLMProvider, private evaluatorProvider: LLMProvider, private sharedDb: BuddyDb) {}

  languages(): Array<{ id: string; name: string }> {
    return listAvailableLanguages().map((lang) => ({ id: lang.id, name: lang.name }));
  }

  hasLanguage(language: string): boolean {
    return this.runtimes.has(language);
  }

  async addLanguage(language: string): Promise<void> {
    if (this.runtimes.has(language)) return;
    const lang = loadLanguage(language);
    const dreamMemoryPath = path.join(this.config.dataDir, "memory", `MEMORY-${lang.id}.md`);
    const db = this.sharedDb.withLanguage(lang.id, lang.errorCategories, lang.morphologyCategories);

    const toolCtx = {
      vocab: db,
      errors: db,
      profile: this.sharedDb,
      langProfile: db,
      interests: this.sharedDb,
      competency: db,
      session: db,
      learning: db,
      provider: this.provider,
    };
    const promptBuilder = new PromptBuilder(
      { vocab: db, errors: db, profile: this.sharedDb, langProfile: db, interests: this.sharedDb, competency: db, session: db },
      lang,
    );
    const agentRunner = new AgentRunner({ provider: this.provider, evaluatorProvider: this.evaluatorProvider, session: db, promptBuilder, toolCtx, lang, dreamMemoryPath });
    const dreamService = new DreamService(db, db, db, this.evaluatorProvider, {
      timezone: this.config.timezone,
      dreamMemoryPath,
      dreamSystemPrompt: lang.prompts.dream,
      morphologyCategories: new Set(lang.morphologyCategories),
    });

    this.runtimes.set(lang.id, { lang, db, sharedDb: this.sharedDb, agentRunner, dreamService, dreamMemoryPath });
  }

  runtime(language: string): LanguageRuntime {
    const rt = this.runtimes.get(language);
    if (!rt) throw new Error(`Unknown language: ${language}`);
    return rt;
  }

  async handleMessage(language: string, chatId: number, _userId: string, text: string): Promise<string | null> {
    const rt = this.runtime(language);
    const { db, agentRunner } = rt;

    const { session: convState } = await db.getConversationState();
    const history = await db.getSessionTranscript(convState.session_id, MODEL_HISTORY_LIMIT) as ChatMessage[];
    await db.addChatMessage(chatId, "user", text, convState.session_id);

    const commandReply = await this.handleCommand(rt, text);
    if (commandReply !== undefined) {
      if (commandReply) await db.addChatMessage(chatId, "assistant", commandReply, convState.session_id);
      return commandReply || null;
    }


    const result = await agentRunner.run(text, history);
    if (result.text) await db.addChatMessage(chatId, "assistant", result.text, convState.session_id);
    return result.text || null;
  }

  private async handleCommand(rt: LanguageRuntime, text: string): Promise<string | undefined> {
    const { lang } = rt;
    if (text === "/start") return formatStart(lang);
    if (text.startsWith("/")) return formatCommandRedirect(lang);
    return undefined;
  }

  getChatHistory(language: string, chatId: number, limit?: number): Promise<{ role: string; content: string }[]> {
    return this.runtime(language).db.getChatHistory(chatId, limit);
  }

  close(): void {
    this.sharedDb.close();
  }
}

export async function createRuntimeManager(config: Config, deps: RuntimeDeps = {}): Promise<RuntimeManager> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "memory"), { recursive: true });
  const provider = deps.provider ?? createProvider(config);
  const evaluatorProvider = deps.evaluatorProvider ?? createEvaluatorProvider(config);
  const sharedDb = await BuddyDb.open(config.dbPath, "shared", [], []);
  const manager = new RuntimeManager(config, provider, evaluatorProvider, sharedDb);
  const languageIds = config.transport === "unified"
    ? listAvailableLanguages().map((lang) => lang.id)
    : [process.env.LANGUAGE ?? "spanish"];
  for (const id of languageIds) await manager.addLanguage(id);
  return manager;
}

