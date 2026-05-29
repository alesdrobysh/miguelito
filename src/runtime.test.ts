import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadConfig } from "./infrastructure/config.js";
import { listAvailableLanguages } from "./languages/index.js";
import { createRuntimeManager } from "./runtime.js";
import { TELEGRAM_COMMANDS } from "./transport/TelegramTransport.js";
import type { LLMProvider } from "./providers/interfaces.js";

const MIN_ENV = {
  PROVIDER: "ollama",
  TRANSPORT: "unified",
  TELEGRAM_POLISH_BOT_TOKEN: "pl-token",
  TELEGRAM_SPANISH_BOT_TOKEN: "es-token",
  TELEGRAM_CHAT_ID: "279737838",
} as Record<string, string>;

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...MIN_ENV, ...extra };
}

class FakeProvider implements LLMProvider {
  public chatCalls: any[][] = [];
  public jsonResponses: any[] = [];

  constructor(jsonResponses: any[] = []) {
    this.jsonResponses = [...jsonResponses];
  }

  async chat(messages: any[]): Promise<any> {
    this.chatCalls.push(messages);
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    return { content: `echo:${lastUser}`, toolCalls: [] };
  }

  async complete(_systemPrompt: string | null, userPrompt: string): Promise<string> {
    return `echo:${userPrompt}`;
  }

  async completeJson<T>(): Promise<T> {
    return (this.jsonResponses.shift() ?? {}) as T;
  }
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-runtime-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runtime config", () => {

  it("uses isolated data paths when ENV=test without explicit DATA_DIR", () => {
    const config = loadConfig(env({ ENV: "test", DATA_DIR: undefined, DB_PATH: undefined, DREAM_MEMORY_PATH: undefined }));

    expect(config.dataDir).toBe(path.resolve(process.cwd(), "data-test"));
    expect(config.dbPath).toBe(path.resolve(process.cwd(), "data-test/buddy.db"));
    expect(config.dreamMemoryPath).toBe(path.resolve(process.cwd(), "data-test/memory/MEMORY.md"));
  });

  it("keeps explicit DATA_DIR override even when ENV=test", () => {
    const config = loadConfig(env({ ENV: "test", DATA_DIR: tmpDir, DB_PATH: undefined, DREAM_MEMORY_PATH: undefined }));

    expect(config.dataDir).toBe(tmpDir);
    expect(config.dbPath).toBe(path.join(tmpDir, "buddy.db"));
    expect(config.dreamMemoryPath).toBe(path.join(tmpDir, "memory", "MEMORY.md"));
  });

  it("accepts TRANSPORT=unified with separate Telegram bot tokens for Polish and Spanish", () => {
    const config = loadConfig(env({
      TRANSPORT: "unified",
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_POLISH_BOT_TOKEN: "pl-token",
      TELEGRAM_SPANISH_BOT_TOKEN: "es-token",
      TELEGRAM_CHAT_ID: "279737838",
    }));

    expect(config.transport).toBe("unified");
    expect(config.telegramBotTokens).toEqual({ polish: "pl-token", spanish: "es-token" });
  });

  it("rejects TRANSPORT=unified when either language bot token is missing", () => {
    expect(() => loadConfig(env({
      TRANSPORT: "unified",
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_POLISH_BOT_TOKEN: "pl-token",
      TELEGRAM_SPANISH_BOT_TOKEN: undefined,
      TELEGRAM_CHAT_ID: "279737838",
    }))).toThrow(/TELEGRAM_SPANISH_BOT_TOKEN/);
  });

  it("rejects removed web transport", () => {
    expect(() => loadConfig(env({ TRANSPORT: "web" }))).toThrow(/Unsupported TRANSPORT: web/);
  });

  it("lists all bundled languages for unified runtime", () => {
    expect(listAvailableLanguages().map((l) => l.id)).toEqual(["spanish", "polish"]);
  });
});

describe("runtime manager", () => {
  it("exposes every supported slash command as a valid Telegram menu command", () => {
    expect(TELEGRAM_COMMANDS.map((c) => c.command)).toEqual([
      "start",
      "progress",
      "vocabulary",
      "learning",
      "practice",
      "vocab_candidates",
      "promote_vocab",
      "accept_vocab",
      "reject_vocab",
      "proficiency",
      "memory",
      "dream",
    ]);
    for (const item of TELEGRAM_COMMANDS) {
      expect(item.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.description.length).toBeLessThanOrEqual(256);
    }
  });

  it("loads all languages for unified transport so Telegram bots share one DB instance per language", async () => {
    const config = loadConfig(env({
      TRANSPORT: "unified",
      DATA_DIR: tmpDir,
      TELEGRAM_POLISH_BOT_TOKEN: "pl-token",
      TELEGRAM_SPANISH_BOT_TOKEN: "es-token",
      TELEGRAM_CHAT_ID: "279737838",
    }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });

    expect(manager.hasLanguage("spanish")).toBe(true);
    expect(manager.hasLanguage("polish")).toBe(true);
    expect(manager.hasLanguage("belarusian")).toBe(false);
    manager.close();
    expect(fs.existsSync(path.join(tmpDir, "buddy.db"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "buddy-spanish.db"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "buddy-polish.db"))).toBe(false);
  });

  it("handles multiple languages in one process with isolated chat histories", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });

    const es = await manager.handleMessage("spanish", 777, "test-user", "hola");
    const pl = await manager.handleMessage("polish", 777, "test-user", "cześć");

    expect(es).toBe("echo:hola");
    expect(pl).toBe("echo:cześć");

    const esHistory = await manager.getChatHistory("spanish", 777, 10);
    const plHistory = await manager.getChatHistory("polish", 777, 10);
    expect(esHistory.map((m) => m.content)).toEqual(["hola", "echo:hola"]);
    expect(plHistory.map((m) => m.content)).toEqual(["cześć", "echo:cześć"]);

    manager.close();
  });

  it("lists active learning items through a first-class learning command", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "grammar_point", title: "por vs para", source_type: "user_question", priority: 0.8 });
    await db.addLearningItem({ type: "correction", title: "yo es → yo soy", source_type: "correction", priority: 0.95 });

    const listed = await manager.handleMessage("spanish", 777, "telegram-user", "/learning");

    expect(listed).toContain("🧠 Learning inbox");
    expect(listed).toContain("grammar_point: por vs para");
    expect(listed).toContain("correction: yo es → yo soy");
    manager.close();
  });

  it("starts practice with exactly one active item at a time", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({
      type: "correction",
      title: "yo es → yo soy",
      explanation_l1: "Use soy with yo for ser.",
      prompt_l2: "Corrige: yo es estudiante",
      priority: 0.95,
    });
    await db.addLearningItem({
      type: "grammar_point",
      title: "por vs para",
      explanation_l1: "Purpose usually uses para.",
      priority: 0.8,
    });
    await db.addLearningItem({ type: "phrase", title: "me cuesta + infinitivo", priority: 0.7 });

    const practice = await manager.handleMessage("spanish", 777, "telegram-user", "/practice");

    expect(practice).toContain("🎯 Práctica");
    expect(practice).toContain("Reescribe la frase correctamente:");
    expect(practice).toContain("Corrige: yo es estudiante");
    expect(practice).toContain("Pista: Use soy with yo for ser.");
    expect(practice).not.toContain("2. Grammar");
    expect(practice).not.toContain("3. Phrase");
    expect(practice).not.toContain("Hint");
    expect(practice).not.toContain("echo:/practice");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    manager.close();
  });

  it("grades the next learner message and immediately offers the next practice item", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const evaluator = new FakeProvider([{ grade: 3, note: "Correct rewrite.", corrected_answer: "Yo soy estudiante." }]);
    const manager = await createRuntimeManager(config, { provider, evaluatorProvider: evaluator });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({
      type: "correction",
      title: "yo es → yo soy",
      explanation_l1: "Use soy with yo for ser.",
      prompt_l2: "Corrige: yo es estudiante",
      priority: 0.95,
    });
    await db.addLearningItem({
      type: "grammar_point",
      title: "por vs para",
      explanation_l1: "Purpose usually uses para.",
      priority: 0.8,
    });

    await manager.handleMessage("spanish", 777, "telegram-user", "/practice");
    const feedback = await manager.handleMessage("spanish", 777, "telegram-user", "Yo soy estudiante.");

    expect(feedback).toContain("✅ Práctica completada");
    expect(feedback).toContain("Correct rewrite.");
    expect(feedback).toContain("Siguiente ejercicio");
    expect(feedback).toContain("Gramática: por vs para");
    expect(feedback).not.toContain("Practice complete");
    expect(feedback).not.toContain("Next item");
    expect(feedback).not.toContain("echo:Yo soy estudiante");
    expect(provider.chatCalls).toHaveLength(0);
    const activeAttempts = await db.listActiveLearningPracticeAttempts(10);
    expect(activeAttempts).toHaveLength(1);
    const items = await db.listLearningItems("active", 10);
    const completed = items.find((item) => item.title === "yo es → yo soy")!;
    expect(completed.reps).toBe(1);
    expect(completed.last_practiced_at).toBeTruthy();
    expect(completed.due_at).toBeTruthy();
    manager.close();
  });

  it("stops an active practice session without grading the next normal message", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "me cuesta + infinitivo", priority: 0.8 });

    await manager.handleMessage("spanish", 777, "telegram-user", "/practice");
    const stopped = await manager.handleMessage("spanish", 777, "telegram-user", "/practice stop");
    const normal = await manager.handleMessage("spanish", 777, "telegram-user", "hola normal");

    expect(stopped).toContain("Práctica detenida");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    expect(normal).toBe("echo:hola normal");
    expect(provider.chatCalls).toHaveLength(1);
    manager.close();
  });

  it("says practice is empty when there are no active learning items", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });

    await expect(manager.handleMessage("spanish", 777, "telegram-user", "/practice")).resolves.toBe("Todavía no hay elementos activos para practicar.");
    manager.close();
  });

  it("localizes Polish practice prompts, feedback, and stop message", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const evaluator = new FakeProvider([{ grade: 3, note: "Dobra poprawka." }]);
    const manager = await createRuntimeManager(config, { provider: new FakeProvider(), evaluatorProvider: evaluator });
    const db = manager.runtime("polish").db;
    await db.addLearningItem({
      type: "correction",
      title: "Zrobiłem decyzję → Podjąłem decyzję",
      explanation_l1: "Kalka z angielskiego.",
      priority: 0.95,
    });
    await db.addLearningItem({ type: "phrase", title: "podjąć decyzję", priority: 0.8 });

    const practice = await manager.handleMessage("polish", 777, "telegram-user", "/practice");
    const feedback = await manager.handleMessage("polish", 777, "telegram-user", "Podjąłem decyzję.");
    const stopped = await manager.handleMessage("polish", 777, "telegram-user", "/practice stop");

    expect(practice).toContain("🎯 Ćwiczenie");
    expect(practice).toContain("Popraw zdanie:");
    expect(practice).toContain("Pamiętaj: Kalka z angielskiego.");
    expect(feedback).toContain("✅ Ćwiczenie ukończone");
    expect(feedback).toContain("Dobra poprawka.");
    expect(feedback).toContain("Następne ćwiczenie");
    expect(feedback).toContain("Zwrot: podjąć decyzję");
    expect(stopped).toContain("Ćwiczenie zatrzymane");
    for (const englishLeak of ["Practice complete", "Next item", "Hint", "Practice stopped", "Phrase:"]) {
      expect(`${practice}\n${feedback}\n${stopped}`).not.toContain(englishLeak);
    }

    manager.close();
  });

  it("localizes deterministic practice grading notes when the evaluator is unavailable", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider(), evaluatorProvider: new FakeProvider() });
    const spanishDb = manager.runtime("spanish").db;
    const polishDb = manager.runtime("polish").db;
    await spanishDb.addLearningItem({ type: "correction", title: "yo es → yo soy", priority: 0.95 });
    await polishDb.addLearningItem({ type: "correction", title: "Zrobiłem decyzję → Podjąłem decyzję", priority: 0.95 });

    await manager.handleMessage("spanish", 777, "telegram-user", "/practice");
    const spanishFeedback = await manager.handleMessage("spanish", 777, "telegram-user", "yo soy");
    await manager.handleMessage("polish", 777, "telegram-user", "/practice");
    const polishFeedback = await manager.handleMessage("polish", 777, "telegram-user", "Podjąłem decyzję");

    expect(spanishFeedback).toContain("Parece que usaste la forma corregida.");
    expect(polishFeedback).toContain("Wygląda na to, że użyłeś poprawionej formy.");
    expect(`${spanishFeedback}\n${polishFeedback}`).not.toContain("Looks like you used the corrected form.");
    manager.close();
  });

  it("marks zero-observation proficiency dimensions as untested instead of scored", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });

    const proficiency = await manager.handleMessage("spanish", 777, "telegram-user", "/proficiency");

    expect(proficiency).toContain("Morphology: untested");
    expect(proficiency).toContain("Idiomaticity: untested");
    expect(proficiency).not.toContain("Morphology: 50% (0 obs)");
    expect(proficiency).not.toContain("Idiomaticity: 50% (0 obs)");
    manager.close();
  });

  it("supports Telegram-menu underscore aliases for vocabulary candidate commands", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const db = manager.runtime("spanish").db;
    const candidateId = await db.addVocabCandidate({
      chunk_l2: "aprovechar el trayecto",
      source_type: "conversation",
      priority: 0.9,
    });

    const listed = await manager.handleMessage("spanish", 777, "telegram-user", "/vocab_candidates");
    expect(listed).toContain(`#${candidateId}`);
    await expect(manager.handleMessage("spanish", 777, "telegram-user", "/accept_vocab")).resolves.toBe("Usage: /accept-vocab <candidate_id>");

    const rejected = await manager.handleMessage("spanish", 777, "telegram-user", `/reject_vocab ${candidateId}`);
    expect(rejected).toBe(`🗑️ rejected #${candidateId}`);

    manager.close();
  });
});
