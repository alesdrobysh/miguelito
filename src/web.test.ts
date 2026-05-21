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

class FakeProvider implements LLMProvider {
  public chatCalls: any[][] = [];

  async chat(messages: any[]): Promise<any> {
    this.chatCalls.push(messages);
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

    const reply = await server.handleApi("POST", "/api/chat", { language: "belarusian", text: "вітаю" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).reply).toBe("echo:вітаю");

    const history = await server.handleApi("GET", "/api/chat?language=belarusian");
    expect(JSON.parse(history.body).messages.map((m: any) => m.content)).toEqual(["вітаю", "echo:вітаю"]);

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
  });

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
