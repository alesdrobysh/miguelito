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
  it("exposes no learning-system commands in the Telegram menu", () => {
    expect(TELEGRAM_COMMANDS.map((c) => c.command)).toEqual([
      "start",
    ]);
    for (const item of TELEGRAM_COMMANDS) {
      expect(item.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.description.length).toBeLessThanOrEqual(256);
    }
  });

  it("keeps start chat-first and avoids showing a learning app surface", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });

    const start = await manager.handleMessage("spanish", 777, "telegram-user", "/start");

    expect(start).toContain("Escribe de forma natural");
    expect(start).not.toContain("Comandos");
    expect(start).not.toContain("/practice");
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


  it("redirects practice commands back to normal conversation instead of starting drills", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const provider = new FakeProvider();
    const manager = await createRuntimeManager(config, { provider });
    const db = manager.runtime("spanish").db;
    await db.addLearningItem({ type: "phrase", title: "me cuesta + infinitivo", priority: 0.8 });

    const practice = await manager.handleMessage("spanish", 777, "telegram-user", "/practice");
    const practiceStop = await manager.handleMessage("spanish", 777, "telegram-user", "/practice stop");

    expect(practice).toBe("Escríbeme normalmente; yo recordaré lo útil y lo traeré de vuelta en la conversación.");
    expect(practiceStop).toBe("Escríbeme normalmente; yo recordaré lo útil y lo traeré de vuelta en la conversación.");
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

    const normal = await manager.handleMessage("spanish", 777, "telegram-user", "hola normal");

    expect(normal).toBe("echo:hola normal");
    expect(provider.chatCalls).toHaveLength(1);
    const attempts = await db.listActiveLearningPracticeAttempts(10);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].user_response).toBeNull();
    manager.close();
  });

});
