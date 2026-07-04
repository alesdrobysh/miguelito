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
import { LearningHygieneService } from "./services/LearningHygieneService.js";
import { SpanishScenarios } from "./languages/spanish/scenarios.js";
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
  evaluatorProvider: LLMProvider;
  promptBuilder: PromptBuilder;
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
const DRILL_SESSION_TTL_MS = 10 * 60 * 1000;
const DRILL_SESSION_META_KEY = "drill_started_at";
const ACTIVE_SCENARIO_META_KEY = "active_scenario";

interface ActiveScenarioState {
  id: string;
  turns: number;
}

function formatStart(_lang: LanguageConfig): string {
  return [
    "Hola — soy Miguelito, tu tutor de español.",
    "Para empezar, cuéntame en español, aunque sea con frases simples, o importa frases con /import:",
    "1. ¿Cómo te llamas?",
    "2. ¿Por qué quieres practicar español?",
    "3. ¿Qué temas te interesan?",
    "4. ¿Cómo prefieres que te corrija: suave, normal o directo?",
    "",
    "También puedes pegar vocabulario con /import y pedir un mini entrenamiento con /drill.",
  ].join("\n");
}

function formatCommandRedirect(_lang: LanguageConfig): string {
  return "Escríbeme normalmente; yo recordaré lo útil y lo traeré de vuelta en la conversación.";
}

interface ImportedPracticeItem {
  title: string;
  translation?: string;
}

function parseImportedPracticeItems(text: string): ImportedPracticeItem[] {
  const body = text.replace(/^\/import(?:@[^\s]+)?\s*/i, "");
  const seen = new Set<string>();
  const items: ImportedPracticeItem[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^[-*•]\s*/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s*(?:=|—|–)\s*/).map((p) => p.trim()).filter(Boolean);
    const title = (parts[0] ?? "").trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ title, translation: parts.slice(1).join(" — ") || undefined });
  }
  return items.slice(0, 100);
}

function drillLine(item: { title: string; explanation_l1?: string | null; source_type?: string | null; type?: string | null }, n: number): string {
  const translation = item.source_type === "imported" ? item.explanation_l1?.trim() : "";
  if (translation) return `${n}. Traduce al español: “${translation}”.`;
  const correction = item.title.split(/→|->/).map((part) => part.trim()).filter(Boolean);
  if (item.type === "correction" && correction.length >= 2) return `${n}. Reescribe correctamente: “${correction[0]}”.`;
  if (item.type === "grammar_point") return `${n}. Escribe una frase natural que practique: “${item.title}”.`;
  const displayTitle = item.title.replace(/^spelling of\s+/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim() || item.title;
  return `${n}. Escribe una frase personal y natural con “${displayTitle}”.`;
}

function drillTarget(item: { title: string; type?: string | null }): string {
  const correction = item.title.split(/→|->/).map((part) => part.trim()).filter(Boolean);
  if (item.type === "correction" && correction.length >= 2) return correction[correction.length - 1]!;
  return item.title.replace(/^spelling of\s+/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim() || item.title;
}

function normalizePracticeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function drillTargetCandidates(item: { title: string; type?: string | null }): string[] {
  const target = drillTarget(item);
  // ponytail: slash variants only; upgrade to synonym/evaluator grading if drills need semantic answers.
  return target.split("/").map((part) => part.trim()).filter(Boolean);
}

function drillHelpLine(item: { title: string; explanation_l1?: string | null; type?: string | null }): string {
  const target = drillTarget(item);
  const explanation = item.explanation_l1?.trim();
  const hint = explanation ? `Pista: ${explanation}` : `Pista: intenta usar “${target}”.`;
  return `${hint}\nRespuesta modelo: “${target}”. Escríbela tú en una frase o usa /drill stop.`;
}

function correctionSides(title: string): { left: string; right: string } | null {
  const parts = title.split(/→|->/).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? { left: parts[0], right: parts[1] } : null;
}

function isTinyCorrectionTitle(title: string): boolean {
  const sides = correctionSides(title);
  return !!sides
    && (sides.left.match(/[\p{L}\p{N}]+/gu) ?? []).length === 1
    && (sides.right.match(/[\p{L}\p{N}]+/gu) ?? []).length === 1;
}

function isCoveredTinyCorrection(item: { id: number; title: string; type?: string | null }, all: Array<{ id: number; title: string; type?: string | null }>): boolean {
  if (item.type !== "correction" || !isTinyCorrectionTitle(item.title)) return false;
  const sides = correctionSides(item.title);
  if (!sides) return false;
  const left = normalizePracticeText(sides.left);
  const right = normalizePracticeText(sides.right);
  if (!left || !right || left === right) return true;
  return all.some((other) => {
    if (other.id === item.id || other.type !== "correction") return false;
    const otherSides = correctionSides(other.title);
    if (!otherSides || isTinyCorrectionTitle(other.title)) return false;
    return normalizePracticeText(otherSides.left).includes(left) && normalizePracticeText(otherSides.right).includes(right);
  });
}

function answerUsesItem(answer: string, item: { title: string; type?: string | null }): boolean {
  if (item.type === "grammar_point") return normalizePracticeText(answer).length >= 8;
  const normalizedAnswer = ` ${normalizePracticeText(answer)} `;
  return drillTargetCandidates(item).some((target) => {
    const normalizedTitle = normalizePracticeText(target);
    return normalizedTitle.length > 0 && normalizedAnswer.includes(` ${normalizedTitle} `);
  });
}

function splitNumberedPracticeAnswers(text: string): string[] {
  const trimmed = text.trim();
  const marker = /\b\d+(?:\s*,\s*\d+)*\s*[.)]\s*/g;
  const matches = [...trimmed.matchAll(marker)];
  if (matches.length <= 1 || matches[0]?.index !== 0) return [text];
  return matches.map((match, idx) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[idx + 1]?.index ?? trimmed.length;
    return trimmed.slice(start, end).trim();
  }).filter(Boolean);
}

function formatAttemptQueue(title: string, attempts: Array<{ prompt_text?: string | null }>): string {
  return [
    title,
    ...attempts.map((attempt, idx) => (attempt.prompt_text || `${idx + 1}. Sigue con otra frase corta.`).replace(/^\d+\./, `${idx + 1}.`)),
  ].join("\n");
}

function parseDrillTimestamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDrillStopText(text: string): boolean {
  const trimmed = text.trim();
  return /^(?:\/drill(?:@[^\s]+)?\s+)?(?:stop|reset|cancelar|parar)(?:\s|$)/i.test(trimmed)
    || /^(?:drill|дрил)\s+(?:stop|стоп|cancel|cancelar|parar)(?:\s|$)/i.test(trimmed);
}

function isDrillHelpText(text: string): boolean {
  const normalized = normalizePracticeText(text);
  return /^(?:no se|no lo se|no entiendo|ayuda|pista|help|hint|what do you want|que quieres|que quieres de mi|что делать|не знаю|не понимаю|помощь|подсказка)$/.test(normalized);
}

function hasExpiredDrillSession(startedAt: string | null | undefined, now = Date.now()): boolean {
  const started = parseDrillTimestamp(startedAt);
  return started != null && now - started > DRILL_SESSION_TTL_MS;
}

function hasStaleDrillAttempt(attempts: Array<{ created_at: string }>, now = Date.now()): boolean {
  return attempts.some((attempt) => {
    const created = parseDrillTimestamp(attempt.created_at);
    return created != null && now - created > DRILL_SESSION_TTL_MS;
  });
}

function parseActiveScenario(raw: string | null | undefined): ActiveScenarioState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveScenarioState>;
    if (typeof parsed.id === "string" && Number.isFinite(parsed.turns)) return { id: parsed.id, turns: Number(parsed.turns) };
  } catch {}
  return null;
}

function formatScenarioEnd(scenario: { title: string }): string {
  return [
    `Escenario terminado: ${scenario.title}.`,
    "Buen trabajo. Seguimos conversando normalmente, o usa /scenario para elegir otro.",
  ].join("\n");
}

function isScenarioEndText(text: string): boolean {
  const normalized = normalizePracticeText(text);
  // ponytail: deterministic closers only; upgrade to evaluator-based roleplay completion if nuanced endings matter.
  return /^(?:gracias(?: eso es todo| nada mas)?|eso es todo|nada mas|ya esta|listo|terminamos|fin|cancelar|parar)$/.test(normalized);
}

function isDrillSelectable(item: { id: number; status: string; evidence_count?: number | null; next_reactivation_at?: string | null }, dueIds: Set<number>, now = Date.now()): boolean {
  if (!["active", "cooling_down", "candidate"].includes(item.status)) return false;
  if (dueIds.has(item.id)) return true;
  if ((item.evidence_count ?? 0) === 0) return true;
  if (!item.next_reactivation_at) return true;
  const dueAt = Date.parse(item.next_reactivation_at);
  return Number.isFinite(dueAt) ? dueAt <= now : true;
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

  async addLanguageConfig(lang: LanguageConfig, dreamMemoryPath: string): Promise<void> {
    if (this.runtimes.has(lang.id)) return;
    const db = this.sharedDb.withLanguage(lang.id, lang.errorCategories, lang.morphologyCategories);
    const toolCtx = {
      errors: db, profile: this.sharedDb, langProfile: db,
      interests: this.sharedDb, competency: db, session: db, learning: db,
      provider: this.provider,
    };
    const promptBuilder = new PromptBuilder(
      { errors: db, profile: this.sharedDb, langProfile: db, interests: this.sharedDb, competency: db, session: db, learning: db },
      lang,
    );
    const agentRunner = new AgentRunner({ provider: this.provider, evaluatorProvider: this.evaluatorProvider, session: db, promptBuilder, toolCtx, lang, dreamMemoryPath });
    const dreamService = new DreamService(db, db, db, this.evaluatorProvider, {
      timezone: this.config.timezone,
      dreamMemoryPath,
      dreamSystemPrompt: lang.prompts.dream,
      morphologyCategories: new Set(lang.morphologyCategories),
      langId: lang.id,
    }, db, new LearningHygieneService(db));
    this.runtimes.set(lang.id, { lang, db, sharedDb: this.sharedDb, agentRunner, evaluatorProvider: this.evaluatorProvider, promptBuilder, dreamService, dreamMemoryPath });
  }

  async addLanguage(language: string): Promise<void> {
    if (this.runtimes.has(language)) return;
    const lang = loadLanguage(language);
    const dreamMemoryPath = path.join(this.config.dataDir, "memory", `MEMORY-${lang.id}.md`);
    const db = this.sharedDb.withLanguage(lang.id, lang.errorCategories, lang.morphologyCategories);

    const toolCtx = {
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
      { errors: db, profile: this.sharedDb, langProfile: db, interests: this.sharedDb, competency: db, session: db, learning: db },
      lang,
    );
    const agentRunner = new AgentRunner({ provider: this.provider, evaluatorProvider: this.evaluatorProvider, session: db, promptBuilder, toolCtx, lang, dreamMemoryPath });
    const dreamService = new DreamService(db, db, db, this.evaluatorProvider, {
      timezone: this.config.timezone,
      dreamMemoryPath,
      dreamSystemPrompt: lang.prompts.dream,
      morphologyCategories: new Set(lang.morphologyCategories),
      langId: lang.id,
    }, db, new LearningHygieneService(db));

    this.runtimes.set(lang.id, { lang, db, sharedDb: this.sharedDb, agentRunner, evaluatorProvider: this.evaluatorProvider, promptBuilder, dreamService, dreamMemoryPath });
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
    await db.setMetaValue(`last_user_message_at:${language}`, new Date().toISOString());

    const commandReply = await this.handleCommand(rt, text);
    if (commandReply !== undefined) {
      if (commandReply) await db.addChatMessage(chatId, "assistant", commandReply, convState.session_id);
      return commandReply || null;
    }

    const drillReply = await this.processDrillAnswers(db, text);
    if (drillReply) {
      await db.addChatMessage(chatId, "assistant", drillReply, convState.session_id);
      return drillReply;
    }

    const scenarioReply = await this.processActiveScenario(db, text);
    if (scenarioReply) {
      await db.addChatMessage(chatId, "assistant", scenarioReply, convState.session_id);
      return scenarioReply;
    }

    const result = await agentRunner.run(text, history);
    if (result.text) await db.addChatMessage(chatId, "assistant", result.text, convState.session_id);
    return result.text || null;
  }

  private async handleCommand(rt: LanguageRuntime, text: string): Promise<string | undefined> {
    const { lang, db } = rt;
    const commandToken = text.split(/\s+/, 1)[0]?.replace(/@[^\s]+$/, "");
    if (commandToken === "/start") return formatStart(lang);
    if (commandToken === "/import") return this.handleImportCommand(db, text);
    if (commandToken === "/drill") return this.handleDrillCommand(db, text);
    if (commandToken === "/scenario") return this.handleScenarioCommand(db, text);
    if (text.startsWith("/")) return formatCommandRedirect(lang);
    return undefined;
  }

  private async handleScenarioCommand(db: BuddyDb, text: string): Promise<string> {
    const id = text.replace(/^\/scenario(?:@[^\s]+)?\s*/i, "").trim();
    if (!id) {
      return [
        "Escenarios cortos disponibles:",
        ...SpanishScenarios.map((s) => `/${"scenario"} ${s.id} — ${s.title}`),
      ].join("\n");
    }
    const scenario = SpanishScenarios.find((s) => s.id === id);
    if (!scenario) return "No conozco ese escenario. Usa /scenario para ver las opciones.";
    await db.setMetaValue(ACTIVE_SCENARIO_META_KEY, JSON.stringify({ id: scenario.id, turns: 0 } satisfies ActiveScenarioState));
    return [`Escenario: ${scenario.title}`, scenario.setup_l1, scenario.opening_line_l2].join("\n");
  }

  private async processActiveScenario(db: BuddyDb, text: string): Promise<string | null> {
    const state = parseActiveScenario(await db.getMetaValue(ACTIVE_SCENARIO_META_KEY));
    if (!state) return null;
    const scenario = SpanishScenarios.find((s) => s.id === state.id);
    if (!scenario) {
      await db.setMetaValue(ACTIVE_SCENARIO_META_KEY, "");
      return null;
    }
    const turns = state.turns + 1;
    if (isScenarioEndText(text) || turns >= scenario.maxTurns) {
      await db.setMetaValue(ACTIVE_SCENARIO_META_KEY, "");
      return formatScenarioEnd(scenario);
    }
    await db.setMetaValue(ACTIVE_SCENARIO_META_KEY, JSON.stringify({ id: scenario.id, turns } satisfies ActiveScenarioState));
    return null;
  }

  private async handleImportCommand(db: BuddyDb, text: string): Promise<string> {
    const items = parseImportedPracticeItems(text);
    if (items.length === 0) {
      return [
        "Pega las frases después de /import, una por línea.",
        "Ejemplo:",
        "/import",
        "bochorno = muggy heat",
        "ola de calor = heat wave",
      ].join("\n");
    }
    let imported = 0;
    for (const item of items) {
      const id = await db.addLearningItem({
        type: item.title.includes("→") || item.title.includes("->") ? "correction" : "phrase",
        title: item.title,
        prompt_l2: item.title,
        explanation_l1: item.translation,
        source_type: "imported",
        evidence_snippet: item.translation ? `${item.title} = ${item.translation}` : item.title,
        priority: 0.95,
        status: "active",
        practice_modes: ["recall", "use_in_sentence"],
        tags: ["imported"],
      });
      if (id != null) imported++;
    }
    return `Perfecto. Tengo ${imported} frases para entrenar. Las voy a mezclar en nuestras conversaciones. Usa /drill cuando quieras un mini entrenamiento enfocado.`;
  }

  private async handleDrillCommand(db: BuddyDb, text: string): Promise<string> {
    if (isDrillStopText(text)) return this.stopDrill(db);
    const active = await this.listFreshDrillAttempts(db, 10);
    if (active.length > 0) return formatAttemptQueue("Drill en curso — resuelve este ejercicio o usa /drill stop:", active);

    await db.setMetaValue(DRILL_SESSION_META_KEY, new Date().toISOString());
    const next = await this.startNextDrillAttempt(db);
    if (next.length === 0) {
      await db.setMetaValue(DRILL_SESSION_META_KEY, "");
      return "Todavía no tengo material para entrenar. Escribe normalmente o pega frases con /import y las practicamos.";
    }
    return formatAttemptQueue("Drill de 10 minutos — responde; seguiré hasta /drill stop o hasta que se acabe el tiempo:", next);
  }

  private async processDrillAnswers(db: BuddyDb, text: string): Promise<string | null> {
    if (isDrillStopText(text)) return this.stopDrill(db);
    const startedAt = await db.getMetaValue(DRILL_SESSION_META_KEY);
    const rawAttempts = await db.listActiveLearningPracticeAttempts(10);
    if (rawAttempts.length > 0 && parseDrillTimestamp(startedAt) != null && hasExpiredDrillSession(startedAt)) {
      const feedback = await this.formatDrillFeedback(db);
      await db.abandonActiveLearningPracticeAttempts("stale drill expired");
      await db.setMetaValue(DRILL_SESSION_META_KEY, "");
      return ["Drill terminado por tiempo.", feedback].filter(Boolean).join("\n");
    }
    const attempts = await this.listFreshDrillAttempts(db, 10);
    if (attempts.length === 0) return null;
    const drillItems = new Map((await db.listLearningItems("all", 200))
      .map((item) => [item.id, item]));
    const currentItem = drillItems.get(attempts[0].learning_item_id);
    if (currentItem && isDrillHelpText(text)) {
      return [
        "Sin problema — te doy una pista para el ejercicio actual.",
        drillHelpLine(currentItem),
        formatAttemptQueue("Ejercicio actual:", [attempts[0]]),
      ].join("\n");
    }
    const answers = splitNumberedPracticeAnswers(text);
    let completed = 0;
    const completedTitles: string[] = [];
    for (let idx = 0; idx < attempts.length; idx++) {
      const attempt = attempts[idx];
      const answer = answers.length > 1 ? answers[idx] : text;
      const item = drillItems.get(attempt.learning_item_id);
      if (!item || !answer) break;
      const success = answerUsesItem(answer, item);
      if (!success) {
        if (completed === 0) {
          return [
            "Casi. Prueba con el punto actual:",
            item ? drillHelpLine(item) : "",
            formatAttemptQueue("", [attempt]).trim(),
          ].filter(Boolean).join("\n");
        }
        break;
      }
      await db.finishLearningPracticeAttempt({
        attempt_id: attempt.id,
        user_response: answer,
        grade: 4,
        note: "drill matched target",
      });
      await db.recordLearningItemEvidence({
        learning_item_id: item.id,
        skill: "active",
        event: "produced_after_prompt",
        independence: "elicited",
        score_delta: 0.2,
        confidence: 0.8,
        evidence_snippet: answer,
        source_type: "drill",
      });
      completed++;
      completedTitles.push(drillTarget(item));
      if (answers.length <= 1) break;
    }
    const remaining = await db.listActiveLearningPracticeAttempts(5);
    const noun = completed === 1 ? "respuesta" : "respuestas";
    if (remaining.length > 0) return formatAttemptQueue(`¡Bien! He marcado ${completed} ${noun}.\nSiguiente:`, remaining);

    if (!hasExpiredDrillSession(await db.getMetaValue(DRILL_SESSION_META_KEY))) {
      const next = await this.startNextDrillAttempt(db);
      if (next.length > 0) return formatAttemptQueue(`¡Bien! He marcado ${completed} ${noun}.\nSiguiente:`, next);
    }

    const feedback = await this.formatDrillFeedback(db);
    await db.setMetaValue(DRILL_SESSION_META_KEY, "");
    return [
      `¡Bien! He marcado ${completed} ${noun}. Drill completado.`,
      feedback,
    ].filter(Boolean).join("\n");
  }

  private async startNextDrillAttempt(db: BuddyDb) {
    const pressureRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const due = await db.listDueLearningItems(100);
    const dueIds = new Set(due.map((i) => i.id));
    const all = await db.listLearningItems("all", 100);
    const seenTargets = new Set<string>();
    const item = all
      .filter((candidate) => isDrillSelectable(candidate, dueIds) && !isCoveredTinyCorrection(candidate, all))
      .sort((a, b) => (Number(dueIds.has(b.id)) - Number(dueIds.has(a.id)))
        || ((pressureRank[String(b.reactivation_pressure)] ?? 0) - (pressureRank[String(a.reactivation_pressure)] ?? 0))
        || (a.evidence_count - b.evidence_count)
        || (b.priority - a.priority)
        || (a.id - b.id))
      .find((candidate) => {
        const key = normalizePracticeText(drillTarget(candidate));
        if (!key || seenTargets.has(key)) return false;
        seenTargets.add(key);
        return true;
      });
    if (!item) return [];
    const attempt = await db.startLearningPracticeAttempt({ learning_item_id: item.id, prompt_text: drillLine(item, 1) });
    return [attempt];
  }

  private async stopDrill(db: BuddyDb): Promise<string> {
    const feedback = await this.formatDrillFeedback(db);
    await db.abandonActiveLearningPracticeAttempts("drill stopped by user");
    await db.setMetaValue(DRILL_SESSION_META_KEY, "");
    return ["Drill detenido. Seguimos conversando normalmente.", feedback].filter(Boolean).join("\n");
  }

  private async formatDrillFeedback(db: BuddyDb): Promise<string> {
    const startedAt = await db.getMetaValue(DRILL_SESSION_META_KEY);
    const started = parseDrillTimestamp(startedAt);
    if (started == null) return "";
    const result = db.db.exec(
      `SELECT li.title, li.type, lpa.completed_at
       FROM learning_practice_attempts lpa
       JOIN learning_items li ON li.id = lpa.learning_item_id AND li.language = lpa.language
       WHERE lpa.language = ?
         AND lpa.status = 'completed'
         AND lpa.note = 'drill matched target'
       ORDER BY lpa.completed_at ASC, lpa.id ASC`,
      [db.languageId],
    );
    const rows = (result[0]?.values ?? []).filter((row) => {
      const completed = parseDrillTimestamp(String(row[2] ?? ""));
      // ponytail: SQL timestamps are second-precision while session meta has ms; allow same-second completions.
      return completed != null && completed + 1000 >= started;
    });
    if (rows.length === 0) return "";
    const practiced = rows
      .map(([title, type]) => drillTarget({ title: String(title), type: type == null ? null : String(type) }))
      .filter(Boolean)
      .slice(0, 5);
    return [
      "Feedback final:",
      `Correctas: ${rows.length}.`,
      practiced.length ? `Practicado: ${practiced.join(", ")}.` : "",
    ].filter(Boolean).join("\n");
  }

  private async listFreshDrillAttempts(db: BuddyDb, limit: number) {
    const attempts = await db.listActiveLearningPracticeAttempts(limit);
    const startedAt = await db.getMetaValue(DRILL_SESSION_META_KEY) || attempts[0]?.created_at;
    if (!hasExpiredDrillSession(startedAt) && !hasStaleDrillAttempt(attempts)) return attempts;
    await db.abandonActiveLearningPracticeAttempts("stale drill expired");
    await db.setMetaValue(DRILL_SESSION_META_KEY, "");
    return [];
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

