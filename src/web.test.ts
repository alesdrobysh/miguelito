import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";
import { loadConfig } from "./infrastructure/config.js";
import { listAvailableLanguages } from "./languages/index.js";
import { createRuntimeManager } from "./runtime.js";
import { WebServer } from "./web/WebServer.js";
import { TELEGRAM_COMMANDS } from "./transport/TelegramTransport.js";
import type { LLMProvider } from "./providers/interfaces.js";

function extractAssetPaths(html: string): string[] {
  return Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g)).map((m) => m[1]).filter((p) => p.startsWith("/assets/"));
}

const MIN_ENV = {
  PROVIDER: "ollama",
  TRANSPORT: "web",
} as Record<string, string>;

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...MIN_ENV, ...extra };
}

class FakeMirrorTransport {
  public sent: Array<{ chatId: string | number; text: string }> = [];

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-web-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("web config", () => {
  it("accepts TRANSPORT=web without requiring Telegram credentials", () => {
    const config = loadConfig(env({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }));
    expect(config.transport).toBe("web");
    expect(config.webPort).toBe(8787);
    expect(config.webHost).toBe("127.0.0.1");
  });

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
      WEB_HOST: "0.0.0.0",
    }));

    expect(config.transport).toBe("unified");
    expect(config.webHost).toBe("0.0.0.0");
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

  it("lists all bundled languages for the UI", () => {
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

  it("loads all languages for unified transport so Telegram bots and WebUI share one DB instance per language", async () => {
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

    const es = await manager.handleMessage("spanish", 777, "web-user", "hola");
    const pl = await manager.handleMessage("polish", 777, "web-user", "cześć");

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

describe("web server", () => {
  it("serves a React app shell and compiled Vite assets", async () => {
    expect(fs.existsSync(path.join(process.cwd(), "PRODUCT.md"))).toBe(true);
    expect(fs.readFileSync(path.join(process.cwd(), "DESIGN.md"), "utf8")).toContain("Slop guardrails");

    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const server = new WebServer(manager);

    const index = await (server as any).routeRequest({ method: "GET", url: "/chat" });

    expect(index.status).toBe(200);
    expect(index.body).toContain('<div id="root"></div>');
    expect(index.body).toContain('type="module"');
    expect(index.body).not.toContain("function appJs()");
    const assets = extractAssetPaths(index.body);
    expect(assets.some((p) => p.endsWith(".js"))).toBe(true);
    expect(assets.some((p) => p.endsWith(".css"))).toBe(true);

    const jsAsset = await (server as any).routeRequest({ method: "GET", url: assets.find((p) => p.endsWith(".js")) });
    expect(jsAsset.status).toBe(200);
    expect(jsAsset.contentType).toContain("application/javascript");
    expect(() => new vm.Script(jsAsset.body)).not.toThrow();

    const cssAsset = await (server as any).routeRequest({ method: "GET", url: assets.find((p) => p.endsWith(".css")) });
    expect(cssAsset.status).toBe(200);
    expect(cssAsset.contentType).toContain("text/css");
    expect(cssAsset.body).toContain("--surface");
    expect(jsAsset.body).toContain("Chat");
    expect(jsAsset.body).toContain("Correct");
    expect(jsAsset.body).toContain("Explain");
    expect(jsAsset.body).toContain("Practice");
    expect(jsAsset.body).toContain("Review");
    expect(jsAsset.body).toContain("quick-actions");

    manager.close();
  });

  it("serves syntactically valid browser JavaScript so the language dropdown initializes", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const server = new WebServer(manager);

    const index = await (server as any).routeRequest({ method: "GET", url: "/app.js" });

    expect(index.status).toBe(200);
    expect(index.contentType).toContain("text/html");
    expect(index.body).toContain('<div id="root"></div>');

    manager.close();
  });

  it("serves language metadata and rerenderable chat history", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const server = new WebServer(manager);

    const languages = await server.handleApi("GET", "/api/languages");
    expect(languages.status).toBe(200);
    expect(JSON.parse(languages.body).languages.map((l: any) => l.id)).toContain("spanish");

    const reply = await server.handleApi("POST", "/api/chat", { language: "polish", text: "cześć" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).reply).toBe("echo:cześć");

    const history = await server.handleApi("GET", "/api/chat?language=polish");
    expect(JSON.parse(history.body).messages.map((m: any) => m.content)).toEqual(["cześć", "echo:cześć"]);

    manager.close();
  });

  it("mirrors WebUI messages into the configured Telegram chat and uses the same history", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir, TELEGRAM_CHAT_ID: "279737838" }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    await manager.handleMessage("polish", 279737838, "telegram-user", "telegram says cześć");
    const polishMirror = new FakeMirrorTransport();
    const server = new WebServer(manager, {
      chatId: 279737838,
      mirrorTransports: { polish: polishMirror },
    });

    const initial = await server.handleApi("GET", "/api/chat?language=polish");
    expect(JSON.parse(initial.body).messages.map((m: any) => m.content)).toEqual([
      "telegram says cześć",
      "echo:telegram says cześć",
    ]);

    const reply = await server.handleApi("POST", "/api/chat", { language: "polish", text: "web says dzień dobry" });
    expect(reply.status).toBe(200);
    expect(polishMirror.sent).toEqual([
      { chatId: 279737838, text: "🌐 Web: web says dzień dobry" },
      { chatId: 279737838, text: "echo:web says dzień dobry" },
    ]);
    expect(JSON.parse(reply.body).messages.map((m: any) => m.content)).toEqual([
      "telegram says cześć",
      "echo:telegram says cześć",
      "web says dzień dobry",
      "echo:web says dzień dobry",
    ]);

    manager.close();
  });

  it("persists command turns so WebUI and Telegram share command history", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir, TELEGRAM_CHAT_ID: "279737838" }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    await manager.runtime("polish").db.addVocab("wrzód", "ctx");
    const polishMirror = new FakeMirrorTransport();
    const server = new WebServer(manager, {
      chatId: 279737838,
      mirrorTransports: { polish: polishMirror },
    });

    const reply = await server.handleApi("POST", "/api/chat", { language: "polish", text: "/vocabulary" });

    expect(reply.status).toBe(200);
    const body = JSON.parse(reply.body);
    expect(body.reply).toContain("wrzód");
    expect(body.messages.map((m: any) => m.content)).toEqual(["/vocabulary", body.reply]);
    expect(polishMirror.sent).toEqual([
      { chatId: 279737838, text: "🌐 Web: /vocabulary" },
      { chatId: 279737838, text: body.reply },
    ]);

    manager.close();
  });

  it("returns the full durable web history instead of truncating to the model context window", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const server = new WebServer(manager);

    for (let i = 0; i < 60; i++) {
      const response = await server.handleApi("POST", "/api/chat", { language: "spanish", text: `turn-${i}` });
      expect(response.status).toBe(200);
    }

    const history = await server.handleApi("GET", "/api/chat?language=spanish");
    const messages = JSON.parse(history.body).messages;
    expect(messages).toHaveLength(120);
    expect(messages[0].content).toBe("turn-0");
    expect(messages.at(-1).content).toBe("echo:turn-59");

    manager.close();
  }, 10_000);

  it("keeps the model prompt history bounded while retaining older web messages", async () => {
    const provider = new FakeProvider();
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider });

    for (let i = 0; i < 60; i++) {
      await manager.handleMessage("spanish", 0, "web-user", `turn-${i}`);
    }
    await manager.handleMessage("spanish", 0, "web-user", "final-turn");

    const lastCallContents = provider.chatCalls.at(-1)!.map((m) => m.content);
    expect(lastCallContents).not.toContain("turn-0");
    expect(lastCallContents).not.toContain("echo:turn-0");
    expect(lastCallContents).toContain("turn-59");
    expect(lastCallContents).toContain("echo:turn-59");

    const fullHistory = await manager.getChatHistory("spanish", 0);
    expect(fullHistory).toHaveLength(122);
    expect(fullHistory[0].content).toBe("turn-0");

    manager.close();
  });
});
