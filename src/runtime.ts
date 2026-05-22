import fs from "fs";
import path from "path";
import type { Config } from "./infrastructure/config.js";
import { BuddyDb } from "./infrastructure/db.js";
import { listAvailableLanguages, loadLanguage } from "./languages/index.js";
import type { LanguageConfig } from "./languages/LanguageConfig.js";
import { OpenRouterProvider } from "./providers/OpenRouterProvider.js";
import { OllamaProvider } from "./providers/OllamaProvider.js";
import { OpenAICodexProvider } from "./providers/OpenAICodexProvider.js";
import type { LLMProvider } from "./providers/interfaces.js";
import { PromptBuilder } from "./agent/PromptBuilder.js";
import { AgentRunner } from "./agent/AgentRunner.js";
import { DreamService } from "./services/DreamService.js";
import { statusOf } from "./domain/fsrs.js";
import { getCompetencyVector, selectFocusAxis } from "./domain/competency.js";
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
  if (config.provider === "openai-codex") {
    return new OpenAICodexProvider({
      apiKey: config.openaiCodexApiKey,
      model: config.openaiCodexModel,
      baseUrl: config.openaiCodexBaseUrl,
    });
  }
  if (config.provider === "ollama") {
    return new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      apiKey: config.ollamaApiKey || undefined,
    });
  }
  return new OpenRouterProvider({
    apiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    baseUrl: config.openrouterBaseUrl,
  });
}

export function createEvaluatorProvider(config: Config): LLMProvider {
  if (config.provider === "openai-codex") {
    return new OpenAICodexProvider({
      apiKey: config.openaiCodexApiKey,
      model: config.openaiCodexEvaluatorModel,
      baseUrl: config.openaiCodexBaseUrl,
    });
  }
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

function normalizeCommandText(text: string): string {
  if (text.startsWith("/vocab_candidates")) return text.replace("/vocab_candidates", "/vocab-candidates");
  if (text.startsWith("/promote_vocab")) return text.replace("/promote_vocab", "/promote-vocab");
  if (text.startsWith("/accept_vocab")) return text.replace("/accept_vocab", "/accept-vocab");
  if (text.startsWith("/reject_vocab")) return text.replace("/reject_vocab", "/reject-vocab");
  return text;
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
      provider: this.provider,
    };
    const promptBuilder = new PromptBuilder(
      { vocab: db, errors: db, profile: this.sharedDb, langProfile: db, interests: this.sharedDb, competency: db, session: db },
      lang,
    );
    const agentRunner = new AgentRunner({ provider: this.provider, evaluatorProvider: this.evaluatorProvider, session: db, promptBuilder, toolCtx, lang, dreamMemoryPath });
    const dreamService = new DreamService(db, db, db, this.provider, {
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
    text = normalizeCommandText(text);
    const { db, lang, dreamService, dreamMemoryPath } = rt;
    if (text === "/dream") return dreamService.run();
    if (text === "/memory") {
      if (fs.existsSync(dreamMemoryPath)) return fs.readFileSync(dreamMemoryPath, "utf-8");
      return lang.id === "polish" ? "Brak pliku pamięci." : "No memory file found.";
    }
    if (text === "/vocabulary") {
      const items = await db.listVocab("all", 50);
      if (items.length === 0) return lang.id === "polish" ? "Słownictwo jest puste." : "Vocabulary is empty.";
      return items.map((r) => {
        const status = statusOf(r.pro_reps, r.pro_stability);
        const icon = status === "mastered" ? "✅" : status === "review" ? "⏳" : status === "learning" ? "🌱" : "🆕";
        return `${icon} ${r.chunk_l2}${r.anchor ? ` (${r.anchor})` : ""}`;
      }).join("\n");
    }
    if (text === "/vocab-candidates") {
      const items = await db.listVocabCandidates("candidate", 20);
      if (items.length === 0) return lang.id === "polish" ? "Brak kandydatów słownictwa." : "No vocabulary candidates.";
      return items.map((r) => `⭐ #${r.id} ${r.chunk_l2}${r.anchor ? ` (${r.anchor})` : ""} — ${Math.round(r.priority * 100)}%${r.promotion_reason ? `; ${r.promotion_reason}` : ""}`).join("\n");
    }
    if (text === "/promote-vocab") {
      const promoted = await db.promoteVocabCandidates({ maxPromotions: 3, minPriority: 0.75, maxActiveLearningItems: 40 });
      if (promoted.length === 0) return lang.id === "polish" ? "Nic nie awansowało: brak mocnych kandydatów albo pełna kolejka." : "Nothing promoted: no strong candidates or active queue is full.";
      return promoted.map((r) => `✅ ${r.chunk_l2}${r.anchor ? ` (${r.anchor})` : ""}`).join("\n");
    }
    if (text === "/accept-vocab" || text.startsWith("/accept-vocab ")) {
      const id = Number(text.split(/\s+/)[1]);
      if (!Number.isFinite(id) || id <= 0) return "Usage: /accept-vocab <candidate_id>";
      const candidate = (await db.listVocabCandidates("all", 200)).find((c) => c.id === id && c.status === "candidate");
      if (!candidate) return `Candidate #${id} not found.`;
      const promoted = await db.promoteSpecificVocabCandidate(id);
      return promoted ? `✅ ${promoted.chunk_l2}` : `Could not promote #${id}.`;
    }
    if (text === "/reject-vocab" || text.startsWith("/reject-vocab ")) {
      const id = Number(text.split(/\s+/)[1]);
      if (!Number.isFinite(id) || id <= 0) return "Usage: /reject-vocab <candidate_id>";
      const ok = await db.updateVocabCandidateStatus(id, "rejected");
      return ok ? `🗑️ rejected #${id}` : `Candidate #${id} not found.`;
    }
    if (text === "/proficiency") {
      const cv = await getCompetencyVector({ competency: db, vocab: db });
      const focus = selectFocusAxis(cv, lang) ?? "balanced";
      return [
        `📊 ${lang.name} proficiency`,
        `Vocabulary chunks: ${cv.lexicon.activeChunks}`,
        `Morphology: ${Math.round(cv.morphology.rate * 100)}% (${cv.morphology.obs} obs)`,
        `Idiomaticity: ${Math.round(cv.idiomaticity.rate * 100)}% (${cv.idiomaticity.obs} obs)`,
        `Reception: ${Math.round(cv.reception.level * 100)}%`,
        `Focus: ${focus}`,
      ].join("\n");
    }
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
  const sharedDb = await BuddyDb.open(path.join(config.dataDir, "buddy.db"), "shared", [], []);
  const manager = new RuntimeManager(config, provider, evaluatorProvider, sharedDb);
  const languageIds = config.transport === "web" || config.transport === "unified"
    ? listAvailableLanguages().map((lang) => lang.id)
    : [process.env.LANGUAGE ?? "spanish"];
  for (const id of languageIds) await manager.addLanguage(id);
  return manager;
}
