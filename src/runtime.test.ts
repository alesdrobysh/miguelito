import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadConfig } from "./infrastructure/config.js";
import { listAvailableLanguages } from "./languages/index.js";
import { createRuntimeManager } from "./runtime.js";
import { TELEGRAM_ALLOWED_UPDATES, TELEGRAM_COMMANDS, telegramDisplayTextForText, telegramReplyMarkupForText } from "./transport/TelegramTransport.js";
import type { LLMProvider } from "./providers/interfaces.js";

const MIN_ENV = {
  PROVIDER: "ollama",
  TRANSPORT: "unified",
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

  it("accepts TRANSPORT=unified with bot tokens for active languages", () => {
    const config = loadConfig(env({
      TRANSPORT: "unified",
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_SPANISH_BOT_TOKEN: "es-token",
      TELEGRAM_CHAT_ID: "279737838",
    }));

    expect(config.transport).toBe("unified");
    expect(config.telegramBotTokens).toEqual({ spanish: "es-token" });
  });

  it("rejects TRANSPORT=unified when an active language bot token is missing", () => {
    expect(() => loadConfig(env({
      TRANSPORT: "unified",
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_SPANISH_BOT_TOKEN: undefined,
      TELEGRAM_CHAT_ID: "279737838",
    }))).toThrow(/TELEGRAM_SPANISH_BOT_TOKEN/);
  });

  it("rejects removed web transport", () => {
    expect(() => loadConfig(env({ TRANSPORT: "web" }))).toThrow(/Unsupported TRANSPORT: web/);
  });

  it("lists only active languages for unified runtime while inactive configs can remain in-tree", () => {
    expect(listAvailableLanguages().map((l) => l.id)).toEqual(["spanish"]);
  });
});

describe("runtime manager", () => {
  it("exposes only the conversation-first vocabulary training commands in the Telegram menu", () => {
    expect(TELEGRAM_COMMANDS.map((c) => c.command)).toEqual([
      "start",
      "import",
      "drill",
      "scenario",
    ]);
    for (const item of TELEGRAM_COMMANDS) {
      expect(item.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.description.length).toBeLessThanOrEqual(256);
    }
  });

  it("exposes inline buttons for scenario choices in Telegram without duplicating command text", () => {
    const reply = [
      "Escenarios cortos disponibles:",
      "/scenario pedir_comida — Pedir comida",
      "/scenario preguntar_ruta — Preguntar por una ruta",
    ].join("\n");

    expect(telegramReplyMarkupForText(reply)).toEqual({
      inline_keyboard: [
        [{ text: "Pedir comida", callback_data: "/scenario pedir_comida" }],
        [{ text: "Preguntar por una ruta", callback_data: "/scenario preguntar_ruta" }],
      ],
    });
    expect(telegramDisplayTextForText(reply)).toBe("Escenarios cortos disponibles:");
    expect(telegramDisplayTextForText(reply)).not.toContain("/scenario pedir_comida");
    expect(TELEGRAM_ALLOWED_UPDATES).toContain("callback_query");
  });

  it("lists opt-in practice scenarios without entering generic chat", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });

    const list = await manager.handleMessage("spanish", 777, "telegram-user", "/scenario");
    const picked = await manager.handleMessage("spanish", 777, "telegram-user", "/scenario pedir_comida");

    expect(list).toContain("Escenarios cortos disponibles:");
    expect(list).toContain("/scenario pedir_comida");
    expect(picked).toContain("Escenario:");
    expect(picked).toContain("cafetería");
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("ends an active scenario after its configured turn limit", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;

    const started = await manager.handleMessage("spanish", 777, "telegram-user", "/scenario pedir_comida");
    expect(started).toContain("Escenario: Pedir comida");

    for (const text of ["Quiero un café", "También una tostada", "Para llevar", "Pago con tarjeta"]) {
      const reply = await manager.handleMessage("spanish", 777, "telegram-user", text);
      expect(reply).toBe(`echo:${text}`);
    }

    const ended = await manager.handleMessage("spanish", 777, "telegram-user", "Una servilleta, por favor");
    expect(ended).toContain("Escenario terminado");
    expect(await db.getMetaValue("active_scenario")).toBe("");

    const normal = await manager.handleMessage("spanish", 777, "telegram-user", "hola normal");
    expect(normal).toBe("echo:hola normal");
    expect(provider.chatCalls).toHaveLength(5);
    manager.close();
  });

  it("ends an active scenario early when the learner naturally closes it", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;

    await manager.handleMessage("spanish", 777, "telegram-user", "/scenario pedir_comida");
    expect(await manager.handleMessage("spanish", 777, "telegram-user", "Quiero un café"))
      .toBe("echo:Quiero un café");

    const ended = await manager.handleMessage("spanish", 777, "telegram-user", "Gracias, eso es todo");
    expect(ended).toContain("Escenario terminado");
    expect(await db.getMetaValue("active_scenario")).toBe("");

    const normal = await manager.handleMessage("spanish", 777, "telegram-user", "hola normal");
    expect(normal).toBe("echo:hola normal");
    expect(provider.chatCalls).toHaveLength(2);
    manager.close();
  });

  it("keeps start chat-first and avoids showing a learning app surface", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });

    const start = await manager.handleMessage("spanish", 777, "telegram-user", "/start");

    expect(start).toContain("soy Miguelito");
    expect(start).toContain("Para empezar");
    expect(start).toContain("¿Cómo te llamas?");
    expect(start).toContain("¿Por qué quieres practicar español?");
    expect(start).toContain("¿Qué temas te interesan?");
    expect(start).toContain("¿Cómo prefieres que te corrija");

    const startWithBotMention = await manager.handleMessage("spanish", 777, "telegram-user", "/start@my_spanish_buddy_bot");
    expect(startWithBotMention).toContain("Para empezar");
    expect(startWithBotMention).toContain("¿Por qué quieres practicar español?");

    const startWithPayload = await manager.handleMessage("spanish", 777, "telegram-user", "/start onboarding");
    expect(startWithPayload).toContain("Para empezar");
    expect(startWithPayload).toContain("¿Cómo te llamas?");
    expect(startWithPayload).toContain("¿Cómo prefieres que te corrija");

    expect(start).not.toContain("inglés");
    expect(start).not.toContain("ruso");
    expect(start).not.toContain("English");
    expect(start).not.toContain("Russian");
    expect(start).toContain("/import");
    expect(start).toContain("/drill");
    expect(start).not.toContain("/learning");
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("does not expose hidden dashboards or CRM-style commands to learners", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });

    for (const command of ["/learning", "/progress", "/vocabulary", "/proficiency", "/vocab_candidates"]) {
      const reply = await manager.handleMessage("spanish", 777, "telegram-user", command);
      expect(reply).toBe("Escríbeme normalmente; yo recordaré lo útil y lo traeré de vuelta en la conversación.");
    }

    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });


  it("imports plain text practice items as user-controlled training material", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "/import\nbochorno = muggy heat\nola de calor — heat wave\nhacer pesas\n");

    expect(reply).toContain("Perfecto");
    expect(reply).toContain("3");
    expect(reply).toContain("frases para entrenar");
    const items = await db.listLearningItems("all", 10);
    expect(items.map((i) => ({ title: i.title, source_type: i.source_type, explanation_l1: i.explanation_l1 }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "bochorno", source_type: "imported", explanation_l1: "muggy heat" }),
      expect.objectContaining({ title: "ola de calor", source_type: "imported", explanation_l1: "heat wave" }),
      expect.objectContaining({ title: "hacer pesas", source_type: "imported" }),
    ]));
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("runs a short /drill from imported vocabulary instead of redirecting to generic chat", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });

    const drill = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(drill).toContain("Drill de 10 minutos");
    expect(drill).toContain("heat wave");
    expect(drill).not.toContain("lift weights");
    expect(drill).not.toContain("→ ola de calor");
    expect(drill).not.toContain("→ hacer pesas");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("runs /drill from conversation learning items, not only imported items", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "me da igual", explanation_l1: "I don't mind", source_type: "conversation", priority: 0.95 });

    const drill = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(drill).toContain("Drill de 10 minutos");
    expect(drill).not.toContain("I don't mind");
    expect(drill).toContain("me da igual");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("keeps internal learning explanations out of /drill prompts", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "una lista adecuada", explanation_l1: "Learner expressed need to remember 'adecuada'", source_type: "conversation", priority: 0.95 });
    await db.addLearningItem({ type: "correction", title: "opcioces → opciones", explanation_l1: "missing 'n' and extra 'c'", source_type: "correction", priority: 0.95 });
    await db.addLearningItem({ type: "correction", title: "spelling of opciones", explanation_l1: "The word opciones is spelled with n", source_type: "correction", priority: 0.95 });
    await db.addLearningItem({ type: "correction", title: "aplicaciones (plural sin tilde)", explanation_l1: "internal grammar note", source_type: "correction", priority: 0.95 });

    const drill = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(drill).toContain("Escribe una frase personal y natural con “una lista adecuada”.");
    expect(drill).not.toContain("Learner expressed");
    expect(drill).not.toContain("missing 'n'");
    expect(drill).not.toContain("The word opciones");
    expect(drill).not.toContain("internal grammar note");
    expect(drill).not.toContain("spelling of opciones");
    expect(drill).not.toContain("Usa “opciones” en una frase corta.");
    expect(drill).not.toContain("plural sin tilde");
    expect(drill).not.toContain("→ opciones");
    manager.close();
  });

  it("deduplicates drill items that practice the same cleaned target", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "correction", title: "opcioces → opciones", source_type: "correction", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "opciones", source_type: "conversation", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "aplicaciones", source_type: "conversation", priority: 0.95 });

    const drill = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(drill).toContain("Reescribe correctamente: “opcioces”.");
    expect(drill).not.toContain("Escribe una frase personal y natural con “opciones”.");
    expect(drill).not.toContain("Escribe una frase personal y natural con “aplicaciones”.");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    manager.close();
  });

  it("skips extractor artifact corrections in /drill when a phrase correction covers them", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "correction", title: "La hola de calor → La ola de calor", source_type: "correction", priority: 0.8 });
    await db.addLearningItem({ type: "correction", title: "hola → ola", source_type: "correction", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", source_type: "conversation", priority: 0.9 });

    const drill = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(drill).not.toContain("Reescribe correctamente: “hola”.");
    expect(drill).toMatch(/La hola de calor|hacer pesas/);
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    manager.close();
  });

  it("formats grammar drill items as grammar practice, not phrase usage", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "grammar_point", title: "Pretérito indefinido vs imperfecto", source_type: "conversation", priority: 0.95 });

    const drill = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(drill).toContain("Escribe una frase natural que practique: “Pretérito indefinido vs imperfecto”.");
    expect(drill).not.toContain("Escribe una frase personal y natural con “Pretérito indefinido vs imperfecto”.");
    manager.close();
  });

  it("continues drill with the next exercise after a correct answer", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    const aplicacionesId = await db.addLearningItem({ type: "correction", title: "aplicaciones (plural sin tilde)", source_type: "correction", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "Tengo muchas aplicaciones en el móvil");

    expect(reply).toContain("¡Bien!");
    expect(reply).toContain("Siguiente:");
    expect(reply).toContain("lift weights");
    expect(await db.listLearningItemEvidence(aplicacionesId!, 5)).toHaveLength(1);
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("starts one active exercise at a time within a timed drill", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(reply).toBe("Drill de 10 minutos — responde; seguiré hasta /drill stop o hasta que se acabe el tiempo:\n1. Traduce al español: “heat wave”.");
    expect(reply).not.toContain("2.");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("does not repeat a just-completed mini exercise while other items are available", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");
    await manager.handleMessage("spanish", 777, "telegram-user", "La ola de calor fue horrible");

    const next = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(next).toContain("lift weights");
    expect(next).not.toContain("heat wave");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    manager.close();
  });

  it("resumes an active drill instead of creating duplicate attempts", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const resumed = await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    expect(resumed).toContain("Drill en curso");
    expect(resumed).toContain("1. Traduce al español: “heat wave”.");
    expect(resumed).not.toContain("2. ¿Cómo dirías “lift weights” en español?");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("rejects answers for a different item while a mini exercise is active", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "Hacer pesas me ayuda mucho");

    expect(reply).toContain("Casi");
    expect(reply).toContain("Pista:");
    expect(reply).toContain("Respuesta modelo: “ola de calor”");
    expect(reply).toContain("1. Traduce al español: “heat wave”.");
    const attempts = await db.listActiveLearningPracticeAttempts(10);
    expect(attempts).toHaveLength(1);
    expect(attempts.every((attempt) => attempt.user_response == null)).toBe(true);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("gives a hint when the learner asks what the drill wants", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({
      type: "correction",
      title: "Y cuales errores hago? → ¿Y cuáles errores cometo?",
      explanation_l1: "Use cometer errores, not hacer errores.",
      source_type: "correction",
      priority: 0.95,
    });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "не знаю");

    expect(reply).toContain("Sin problema");
    expect(reply).toContain("Pista: Use cometer errores");
    expect(reply).toContain("Respuesta modelo: “¿Y cuáles errores cometo?”");
    expect(reply).toContain("1. Reescribe correctamente: “Y cuales errores hago?”.");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("stops an active drill on /drill stop", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const stopped = await manager.handleMessage("spanish", 777, "telegram-user", "/drill stop");

    expect(stopped).toBe("Drill detenido. Seguimos conversando normalmente.");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("shows final feedback when stopping after completed drill answers", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");
    await manager.handleMessage("spanish", 777, "telegram-user", "La ola de calor fue horrible");

    const stopped = await manager.handleMessage("spanish", 777, "telegram-user", "дрил стоп");

    expect(stopped).toContain("Drill detenido");
    expect(stopped).toContain("Feedback final:");
    expect(stopped).toContain("Correctas: 1");
    expect(stopped).toContain("ola de calor");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("stops an active drill on Russian plain-text drill stop", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const stopped = await manager.handleMessage("spanish", 777, "telegram-user", "дрил стоп");

    expect(stopped).toBe("Drill detenido. Seguimos conversando normalmente.");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("scores drill answers with feedback instead of dropping into generic chat", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    const itemId = await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "La ola de calor fue horrible");

    expect(reply).toContain("¡Bien! He marcado 1 respuesta. Drill completado.");
    expect(reply).toContain("Feedback final:");
    expect(reply).toContain("Correctas: 1");
    expect(reply).toContain("ola de calor");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    const evidence = await db.listLearningItemEvidence(itemId!, 5);
    expect(evidence[0]).toEqual(expect.objectContaining({
      skill: "active",
      event: "produced_after_prompt",
      source_type: "drill",
    }));
    expect(evidence[0].score_delta).toBeGreaterThan(0);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("uses only the current exercise from a numbered batch answer", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "aplicaciones", source_type: "conversation", priority: 0.95 });
    await db.addLearningItem({ type: "grammar_point", title: "Pretérito indefinido vs imperfecto", source_type: "conversation", priority: 0.95 });
    await db.addLearningItem({ type: "correction", title: "llovia → llovía", source_type: "correction", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", [
      "1. Tengo muchas aplicaciones en mi teléfono.",
      "2. Ayer fui al gimnasio.",
      "3. Llovía.",
    ].join("\n"));

    expect(reply).toContain("¡Bien! He marcado 1 respuesta.");
    expect(reply).toContain("Siguiente:");
    expect(reply).toContain("Pretérito indefinido vs imperfecto");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("uses only the current exercise from a single-line numbered answer", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "aplicaciones", source_type: "conversation", priority: 0.95 });
    await db.addLearningItem({ type: "grammar_point", title: "Pretérito indefinido vs imperfecto", source_type: "conversation", priority: 0.95 });
    await db.addLearningItem({ type: "correction", title: "llovia → llovía", source_type: "correction", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "1. Tengo muchas aplicaciones en mi teléfono. 2. Ayer fui al gimnasio. 3. Llovía.");

    expect(reply).toContain("¡Bien! He marcado 1 respuesta.");
    expect(reply).toContain("Siguiente:");
    expect(reply).toContain("Pretérito indefinido vs imperfecto");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(1);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("accepts slash-separated drill target variants", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "despistado / ser despistado", source_type: "conversation", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");

    const reply = await manager.handleMessage("spanish", 777, "telegram-user", "Soy un poco despistado por la mañana");

    expect(reply).toContain("¡Bien! He marcado 1 respuesta. Drill completado.");
    expect(reply).toContain("Feedback final:");
    expect(reply).toContain("Correctas: 1");
    expect(reply).toContain("despistado / ser despistado");
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    expect(provider.chatCalls).toHaveLength(0);
    manager.close();
  });

  it("loads active languages for unified transport so Telegram bots share one DB instance", async () => {
    const config = loadConfig(env({
      TRANSPORT: "unified",
      DATA_DIR: tmpDir,
      TELEGRAM_SPANISH_BOT_TOKEN: "es-token",
      TELEGRAM_CHAT_ID: "279737838",
    }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });

    expect(manager.hasLanguage("spanish")).toBe(true);
    expect(manager.hasLanguage("secondary")).toBe(false);
    expect(manager.hasLanguage("belarusian")).toBe(false);
    manager.close();
    expect(fs.existsSync(path.join(tmpDir, "buddy.db"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "buddy-spanish.db"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "buddy-secondary.db"))).toBe(false);
  });

  it("rejects unknown languages at runtime", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });

    await expect(manager.handleMessage("spanish", 777, "test-user", "hola")).resolves.toBe("echo:hola");
    await expect(manager.handleMessage("secondary", 777, "test-user", "hello")).rejects.toThrow("Unknown language: secondary");

    manager.close();
  });

  it("keeps saved learning material internal instead of listing it as an inbox", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "grammar_point", title: "por vs para", source_type: "user_question", priority: 0.8 });
    await db.addLearningItem({ type: "correction", title: "yo es → yo soy", source_type: "correction", priority: 0.95 });

    const listed = await manager.handleMessage("spanish", 777, "telegram-user", "/learning");

    expect(listed).toBe("Escríbeme normalmente; yo recordaré lo útil y lo traeré de vuelta en la conversación.");
    expect(listed).not.toContain("🧠 Learning inbox");
    expect(listed).not.toContain("grammar_point: por vs para");
    expect(listed).not.toContain("correction: yo es → yo soy");
    manager.close();
  });

  it("does not let abandoned historical practice attempts hijack normal chat", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    const itemId = await db.addLearningItem({ type: "correction", title: "yo es → yo soy", priority: 0.95 });
    expect(itemId).not.toBeNull();
    await db.startLearningPracticeAttempt({ learning_item_id: itemId!, prompt_text: "Corrige: yo es estudiante" });
    await db.abandonActiveLearningPracticeAttempts("historical cleanup");

    const normal = await manager.handleMessage("spanish", 777, "telegram-user", "hola normal");

    expect(normal).toBe("echo:hola normal");
    expect(provider.chatCalls).toHaveLength(1);
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    manager.close();
  });

  it("expires stale active drill attempts before normal chat", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    const itemId = await db.addLearningItem({ type: "phrase", title: "aplicaciones", priority: 0.95 });
    expect(itemId).not.toBeNull();
    await db.startLearningPracticeAttempt({ learning_item_id: itemId!, prompt_text: "Usa aplicaciones" });
    db.db.run(
      "UPDATE learning_practice_attempts SET created_at = ? WHERE language = 'spanish' AND status = 'active'",
      [new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()],
    );

    const normal = await manager.handleMessage("spanish", 777, "telegram-user", "Hola. Fui al gimnasio ayer y hoy descanso");

    expect(normal).toBe("echo:Hola. Fui al gimnasio ayer y hoy descanso");
    expect(provider.chatCalls).toHaveLength(1);
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    manager.close();
  });

  it("ends a drill session after ten minutes with final feedback", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "ola de calor", explanation_l1: "heat wave", source_type: "imported", priority: 0.95 });
    await db.addLearningItem({ type: "phrase", title: "hacer pesas", explanation_l1: "lift weights", source_type: "imported", priority: 0.95 });
    await manager.handleMessage("spanish", 777, "telegram-user", "/drill");
    await manager.handleMessage("spanish", 777, "telegram-user", "La ola de calor fue horrible");
    await db.setMetaValue("drill_started_at", new Date(Date.now() - 11 * 60 * 1000).toISOString());

    const ended = await manager.handleMessage("spanish", 777, "telegram-user", "Hacer pesas me ayuda mucho");

    expect(ended).toContain("Drill terminado por tiempo.");
    expect(ended).toContain("Feedback final:");
    expect(ended).toContain("Correctas: 1");
    expect(ended).toContain("ola de calor");
    expect(provider.chatCalls).toHaveLength(0);
    expect(await db.listActiveLearningPracticeAttempts(10)).toHaveLength(0);
    manager.close();
  });

});
