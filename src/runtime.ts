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
import type { LearningItem, LearningPracticeAttempt } from "./domain/types.js";

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
    model: config.openrouterModel,
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

function isPracticeIntent(text: string, _lang: LanguageConfig): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.startsWith("/")) return false;
  const common = ["practice", "practise", "exercise", "drill", "review"];
  const spanish = ["practicar", "práctica", "practica", "ejercicio", "repasar", "repaso", "entrenar"];
  const russian = ["потрен", "практик", "упражнен", "повтор"];
  const words = [...common, ...spanish, ...russian];
  return words.some((word) => normalized.includes(word));
}

function formatStart(lang: LanguageConfig): string {
  return [
    `Hola — soy ${lang.name}. Escribe de forma natural en español, o en inglés/ruso si necesitas una explicación.`,
    "Recordaré lo útil y lo traeré de vuelta suavemente en la conversación.",
  ].join("\n");
}

function formatCommandRedirect(_lang: LanguageConfig): string {
  return "Escríbeme normalmente; yo recordaré lo útil y lo traeré de vuelta en la conversación.";
}

function formatNoDuePractice(activeCount: number, lang: LanguageConfig): string {
  if (activeCount <= 0) return practiceCopy(lang).noActivePractice;
  return `Tienes ${activeCount} elemento guardado; todavía nada toca practicar. Escribe naturalmente y volveré a sacarlo cuando toque.`;
}

type PracticeCopy = {
  title: string;
  answerBriefly: string;
  nextTitle: string;
  complete: string;
  recorded: string;
  tryAgain: string;
  queueDone: string;
  suggestedAnswer: string;
  hint: string;
  noActivePractice: string;
  stopped: string;
  noneToStop: string;
  typeLabels: Record<string, string>;
};

function practiceCopy(_lang: LanguageConfig): PracticeCopy {
  return {
    title: "🎯 Práctica",
    answerBriefly: "responde brevemente. /practice stop termina la sesión.",
    nextTitle: "Siguiente ejercicio",
    complete: "Práctica completada",
    recorded: "Respuesta guardada",
    tryAgain: "Inténtalo otra vez pronto",
    queueDone: "La cola de práctica está vacía por ahora. Envía /practice más tarde para seguir.",
    suggestedAnswer: "Respuesta sugerida",
    hint: "Pista",
    noActivePractice: "Todavía no hay elementos activos para practicar.",
    stopped: "Práctica detenida. Envía /practice cuando quieras continuar.",
    noneToStop: "No hay una práctica activa para detener.",
    typeLabels: {
      correction: "Corrección",
      grammar_point: "Gramática",
      phrase: "Frase",
      collocation: "Colocación",
      idiom: "Modismo",
      word: "Palabra",
      register_note: "Registro",
      pronunciation: "Pronunciación",
    },
  };
}

function humanizeLearningType(type: string, lang: LanguageConfig): string {
  const copy = practiceCopy(lang);
  return copy.typeLabels[type] ?? type.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function promptForLearningItem(item: LearningItem, _lang: LanguageConfig): string {
  if (item.type === "correction") {
    const wrong = item.title.includes("→") ? item.title.split("→")[0].trim() : item.title;
    return `Reescribe la frase correctamente:\n${item.prompt_l2 ?? wrong}`;
  }
  if (item.prompt_l2) return item.prompt_l2;
  switch (item.type) {
    case "grammar_point":
      return `Haz una frase con este punto gramatical: ${item.title}`;
    case "phrase":
    case "collocation":
    case "idiom":
      return `Usa esto de forma natural en una frase: ${item.title}`;
    case "word":
      return `Usa esta palabra en una respuesta corta: ${item.title}`;
    case "register_note":
      return `Reescribe una frase corta con el registro correcto: ${item.title}`;
    case "pronunciation":
      return `Escribe un ejemplo corto para practicar la pronunciación: ${item.title}`;
    default:
      return `Practica este elemento: ${item.title}`;
  }
}

function isLearningItemDue(item: LearningItem, now = new Date()): boolean {
  if (!item.due_at) return true;
  const due = new Date(item.due_at);
  return Number.isNaN(due.getTime()) || due <= now;
}

function formatPracticeItem(item: LearningItem, lang: LanguageConfig, prefix?: string): string {
  const copy = practiceCopy(lang);
  const title = prefix ?? copy.title;
  const header = `${title} — ${copy.answerBriefly}`;
  const prompt = promptForLearningItem(item, lang);
  const explanation = item.explanation_l1 ? `\n${copy.hint}: ${item.explanation_l1}` : "";
  return `${header}\n${humanizeLearningType(item.type, lang)}: ${item.title}\n${prompt}${explanation}`;
}

function fallbackPracticeGrade(item: LearningItem, response: string, lang: LanguageConfig): { grade: number; note: string; corrected_answer?: string } {
  const answer = response.trim();
  const notes = {
    empty: "Respuesta vacía.",
    corrected: "Parece que usaste la forma corregida.",
    compare: "Compara con",
    recorded: "Respuesta de práctica guardada.",
  };
  if (!answer) return { grade: 1, note: notes.empty };
  if (item.type === "correction" && item.title.includes("→")) {
    const expected = item.title.split("→").pop()?.trim().toLowerCase() ?? "";
    return answer.toLowerCase().includes(expected) ? { grade: 3, note: notes.corrected } : { grade: 2, note: `${notes.compare}: ${expected}` };
  }
  return { grade: answer.length >= 8 ? 3 : 2, note: notes.recorded };
}

function formatPracticeFeedback(grade: number, note: string, corrected?: string, nextItem?: LearningItem, lang?: LanguageConfig): string {
  const copy = lang ? practiceCopy(lang) : undefined;
  const icon = grade >= 3 ? "✅" : grade === 2 ? "🟡" : "🔁";
  const label = grade >= 3 ? copy?.complete ?? "Practice complete" : grade === 2 ? copy?.recorded ?? "Practice recorded" : copy?.tryAgain ?? "Try again soon";
  const lines = [`${icon} ${label}`, note, corrected ? corrected : ""];
  if (nextItem && lang && copy) {
    lines.push(formatPracticeItem(nextItem, lang, copy.nextTitle));
  } else {
    lines.push(copy?.queueDone ?? "Practice queue is done for now. Send /practice later for more.");
  }
  return lines.filter(Boolean).join("\n");
}

function formatObservedRate(label: string, rate: number, obs: number): string {
  if (obs === 0) return `${label}: untested`;
  return `${label}: ${Math.round(rate * 100)}% (${obs} obs)`;
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

    const practiceReply = await this.handlePracticeResponse(rt, text);
    if (practiceReply !== undefined) {
      if (practiceReply) await db.addChatMessage(chatId, "assistant", practiceReply, convState.session_id);
      return practiceReply || null;
    }

    if (isPracticeIntent(text, rt.lang)) {
      const intentReply = await this.startPracticeReply(rt);
      if (intentReply) await db.addChatMessage(chatId, "assistant", intentReply, convState.session_id);
      return intentReply || null;
    }

    const result = await agentRunner.run(text, history);
    if (result.text) await db.addChatMessage(chatId, "assistant", result.text, convState.session_id);
    return result.text || null;
  }

  private async handleCommand(rt: LanguageRuntime, text: string): Promise<string | undefined> {
    const { db, lang } = rt;
    if (text === "/start") return formatStart(lang);
    if (text === "/practice") {
      return this.startPracticeReply(rt);
    }
    if (text === "/practice stop") {
      const stopped = await db.abandonActiveLearningPracticeAttempts("stopped by learner");
      const copy = practiceCopy(lang);
      return stopped > 0 ? copy.stopped : copy.noneToStop;
    }
    if (text.startsWith("/")) return formatCommandRedirect(lang);
    return undefined;
  }

  private async startPracticeReply(rt: LanguageRuntime): Promise<string> {
    const started = await this.startNextPracticeItem(rt);
    if (started) return formatPracticeItem(started, rt.lang);
    const activeItems = await rt.db.listLearningItems("active", 200);
    return formatNoDuePractice(activeItems.length, rt.lang);
  }

  private async startNextPracticeItem(rt: LanguageRuntime): Promise<LearningItem | null> {
    const active = await rt.db.listActiveLearningPracticeAttempts(1);
    const items = await rt.db.listLearningItems("active", 200);
    if (active.length > 0) {
      return items.find((item) => item.id === active[0].learning_item_id) ?? null;
    }
    const next = items.find((item) => isLearningItemDue(item));
    if (!next) return null;
    await rt.db.startLearningPracticeAttempt({ learning_item_id: next.id, prompt_text: promptForLearningItem(next, rt.lang) });
    return next;
  }

  private async handlePracticeResponse(rt: LanguageRuntime, text: string): Promise<string | undefined> {
    if (text.startsWith("/")) return undefined;
    const attempts = await rt.db.listActiveLearningPracticeAttempts(1);
    if (attempts.length === 0) return undefined;
    const attempt = attempts[0] as LearningPracticeAttempt;
    const item = (await rt.db.listLearningItems("all", 200)).find((candidate) => candidate.id === attempt.learning_item_id);
    if (!item) return undefined;

    let evaluation = fallbackPracticeGrade(item, text, rt.lang);
    try {
      const evaluated = await this.evaluatorProvider.completeJson<{ grade?: number; note?: string; corrected_answer?: string }>(
        "Evalúa la respuesta de práctica de español. Devuelve JSON con grade 1-4, note en español y corrected_answer opcional. Sé breve.",
        JSON.stringify({ language: rt.lang.id, item_type: item.type, item_title: item.title, prompt: attempt.prompt_text, learner_response: text }),
        { temperature: 0, structured: true },
      );
      if (Number.isFinite(Number(evaluated.grade))) {
        evaluation = {
          grade: Math.max(1, Math.min(4, Math.round(Number(evaluated.grade)))),
          note: String(evaluated.note || evaluation.note),
          corrected_answer: evaluated.corrected_answer,
        };
      }
    } catch {
      // Keep deterministic fallback if evaluator is unavailable.
    }

    const completed = await rt.db.finishLearningPracticeAttempt({
      attempt_id: attempt.id,
      user_response: text,
      grade: evaluation.grade,
      note: evaluation.note,
    });
    const nextItem = await this.startNextPracticeItem(rt);
    return formatPracticeFeedback(completed.grade ?? evaluation.grade, evaluation.note, evaluation.corrected_answer, nextItem ?? undefined, rt.lang);
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

