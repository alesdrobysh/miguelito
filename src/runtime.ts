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
import { statusOf } from "./domain/fsrs.js";
import { getCompetencyVector, selectFocusAxis } from "./domain/competency.js";
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

function normalizeCommandText(text: string): string {
  if (text.startsWith("/vocab_candidates")) return text.replace("/vocab_candidates", "/vocab-candidates");
  if (text.startsWith("/promote_vocab")) return text.replace("/promote_vocab", "/promote-vocab");
  if (text.startsWith("/accept_vocab")) return text.replace("/accept_vocab", "/accept-vocab");
  if (text.startsWith("/reject_vocab")) return text.replace("/reject_vocab", "/reject-vocab");
  return text;
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

function practiceCopy(lang: LanguageConfig): PracticeCopy {
  if (lang.id === "polish") {
    return {
      title: "🎯 Ćwiczenie",
      answerBriefly: "odpowiedz krótko. /practice stop kończy sesję.",
      nextTitle: "Następne ćwiczenie",
      complete: "Ćwiczenie ukończone",
      recorded: "Odpowiedź zapisana",
      tryAgain: "Spróbuj wkrótce jeszcze raz",
      queueDone: "Kolejka ćwiczeń jest teraz pusta. Wpisz /practice później, żeby wrócić.",
      suggestedAnswer: "Proponowana odpowiedź",
      hint: "Pamiętaj",
      noActivePractice: "Nie ma jeszcze aktywnych learning items do praktyki.",
      stopped: "Ćwiczenie zatrzymane. Wpisz /practice, kiedy chcesz wrócić.",
      noneToStop: "Nie ma aktywnego ćwiczenia do zatrzymania.",
      typeLabels: {
        correction: "Poprawka",
        grammar_point: "Gramatyka",
        phrase: "Zwrot",
        collocation: "Kolokacja",
        idiom: "Idiom",
        word: "Słowo",
        register_note: "Rejestr",
        pronunciation: "Wymowa",
      },
    };
  }
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

function promptForLearningItem(item: LearningItem, lang: LanguageConfig): string {
  if (item.type === "correction") {
    const wrong = item.title.includes("→") ? item.title.split("→")[0].trim() : item.title;
    const instruction = lang.id === "polish" ? "Popraw zdanie:" : "Reescribe la frase correctamente:";
    return `${instruction}\n${item.prompt_l2 ?? wrong}`;
  }
  if (item.prompt_l2) return item.prompt_l2;
  if (lang.id === "polish") {
    switch (item.type) {
      case "grammar_point":
        return `Ułóż jedno zdanie z tym punktem gramatycznym: ${item.title}`;
      case "phrase":
      case "collocation":
      case "idiom":
        return `Użyj tego naturalnie w jednym zdaniu: ${item.title}`;
      case "word":
        return `Użyj tego słowa w krótkiej odpowiedzi: ${item.title}`;
      case "register_note":
        return `Przepisz krótkie zdanie w odpowiednim rejestrze: ${item.title}`;
      case "pronunciation":
        return `Napisz krótki przykład z tym elementem wymowy: ${item.title}`;
      default:
        return `Poćwicz ten element: ${item.title}`;
    }
  }
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
  const notes = lang.id === "polish"
    ? {
      empty: "Pusta odpowiedź.",
      corrected: "Wygląda na to, że użyłeś poprawionej formy.",
      compare: "Porównaj z",
      recorded: "Odpowiedź ćwiczeniowa zapisana.",
    }
    : {
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
  const suggestedLabel = copy?.suggestedAnswer ?? "Suggested answer";
  const lines = [`${icon} ${label}`, note, corrected ? `${suggestedLabel}: ${corrected}` : ""];
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
    if (text === "/learning") {
      const items = await db.listLearningItems("active", 30);
      if (items.length === 0) return lang.id === "polish" ? "Learning inbox jest pusty." : "Learning inbox is empty.";
      return ["🧠 Learning inbox", ...items.map((r) => `#${r.id} ${r.type}: ${r.title}${r.explanation_l1 ? ` — ${r.explanation_l1}` : ""}`)].join("\n");
    }
    if (text === "/practice") {
      const started = await this.startNextPracticeItem(rt);
      if (!started) return practiceCopy(lang).noActivePractice;
      return formatPracticeItem(started, lang);
    }
    if (text === "/practice stop") {
      const stopped = await db.abandonActiveLearningPracticeAttempts("stopped by learner");
      const copy = practiceCopy(lang);
      return stopped > 0 ? copy.stopped : copy.noneToStop;
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
      const receptionLevels = Object.entries(cv.reception.byLevel)
        .map(([level, bucket]) => bucket.score === null ? `${level}: untested` : `${level}: ${Math.round(bucket.score * 100)}% (${bucket.obs} obs)`)
        .join("\n");
      return [
        `📊 ${lang.name} proficiency`,
        `Vocabulary chunks: ${cv.lexicon.activeChunks}`,
        formatObservedRate("Morphology", cv.morphology.rate, cv.morphology.obs),
        formatObservedRate("Idiomaticity", cv.idiomaticity.rate, cv.idiomaticity.obs),
        `Reception EWMA: ${Math.round(cv.reception.level * 100)}%`,
        `Reception by lexical challenge:`,
        receptionLevels,
        `Focus: ${focus}`,
      ].join("\n");
    }
    return undefined;
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
        rt.lang.id === "polish"
          ? "Oceń odpowiedź w ćwiczeniu z języka polskiego. Zwróć JSON z grade 1-4, note po polsku i opcjonalnym corrected_answer. Krótko."
          : "Evalúa la respuesta de práctica de español. Devuelve JSON con grade 1-4, note en español y corrected_answer opcional. Sé breve.",
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

