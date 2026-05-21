import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";
import { loadConfig } from "./infrastructure/config.js";
import { listAvailableLanguages } from "./languages/index.js";
import { createRuntimeManager } from "./runtime.js";
import { WebServer } from "./web/WebServer.js";
import type { LLMProvider } from "./providers/interfaces.js";

const MIN_ENV = {
  PROVIDER: "ollama",
  TRANSPORT: "web",
} as Record<string, string>;

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...MIN_ENV, ...extra };
}

class FakeProvider implements LLMProvider {
  async chat(messages: any[]): Promise<any> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    return { content: `echo:${lastUser}`, toolCalls: [] };
  }

  async complete(_systemPrompt: string | null, userPrompt: string): Promise<string> {
    return `echo:${userPrompt}`;
  }

  async completeJson<T>(): Promise<T> {
    return {} as T;
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

  it("lists all bundled languages for the UI", () => {
    expect(listAvailableLanguages().map((l) => l.id)).toEqual(["spanish", "polish", "belarusian"]);
  });
});

describe("runtime manager", () => {
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
});

describe("web server", () => {
  it("serves syntactically valid browser JavaScript so the language dropdown initializes", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const server = new WebServer(manager);

    const app = await (server as any).routeRequest({ method: "GET", url: "/app.js" });

    expect(app.status).toBe(200);
    expect(app.contentType).toContain("application/javascript");
    expect(() => new vm.Script(app.body)).not.toThrow();

    manager.close();
  });

  it("serves language metadata and rerenderable chat history", async () => {
    const config = loadConfig(env({ DATA_DIR: tmpDir }));
    const manager = await createRuntimeManager(config, { provider: new FakeProvider() });
    const server = new WebServer(manager);

    const languages = await server.handleApi("GET", "/api/languages");
    expect(languages.status).toBe(200);
    expect(JSON.parse(languages.body).languages.map((l: any) => l.id)).toContain("spanish");

    const reply = await server.handleApi("POST", "/api/chat", { language: "belarusian", text: "вітаю" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).reply).toBe("echo:вітаю");

    const history = await server.handleApi("GET", "/api/chat?language=belarusian");
    expect(JSON.parse(history.body).messages.map((m: any) => m.content)).toEqual(["вітаю", "echo:вітаю"]);

    manager.close();
  });
});
