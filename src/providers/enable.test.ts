import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig } from "../infrastructure/config.js";
import { createEvaluatorProvider, createProvider } from "../runtime.js";
import { OllamaProvider } from "./OllamaProvider.js";
import { OpenRouterProvider } from "./OpenRouterProvider.js";

const MIN_ENV = {
  TRANSPORT: "tui",
  OPENROUTER_API_KEY: "sk-test",
} as Record<string, string>;

function env(extra: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...MIN_ENV, ...extra };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("config provider field", () => {
  it("defaults to openrouter when PROVIDER is unset", () => {
    const config = loadConfig(env({}));
    expect(config.provider).toBe("openrouter");
  });

  it("reads PROVIDER=ollama", () => {
    const config = loadConfig(env({ PROVIDER: "ollama" }));
    expect(config.provider).toBe("ollama");
  });

  it("rejects removed openai-codex provider config", () => {
    expect(() =>
      loadConfig(env({ PROVIDER: "openai-codex" }))
    ).toThrow("Unsupported PROVIDER: openai-codex");
  });


  it("reads ollamaBaseUrl from OLLAMA_BASE_URL", () => {
    const config = loadConfig(
      env({ PROVIDER: "ollama", OLLAMA_BASE_URL: "http://192.168.1.5:11434/v1" }),
    );
    expect(config.ollamaBaseUrl).toBe("http://192.168.1.5:11434/v1");
  });

  it("defaults ollamaBaseUrl", () => {
    const config = loadConfig(env({ PROVIDER: "ollama" }));
    expect(config.ollamaBaseUrl).toBe("http://localhost:11434/v1");
  });

  it("reads ollamaModel from OLLAMA_MODEL", () => {
    const config = loadConfig(env({ PROVIDER: "ollama", OLLAMA_MODEL: "mistral" }));
    expect(config.ollamaModel).toBe("mistral");
  });

  it("defaults ollamaModel to llama3.2", () => {
    const config = loadConfig(env({ PROVIDER: "ollama" }));
    expect(config.ollamaModel).toBe("llama3.2");
  });

  it("reads ollamaApiKey from OLLAMA_API_KEY", () => {
    const config = loadConfig(env({ PROVIDER: "ollama", OLLAMA_API_KEY: "sk-ollama" }));
    expect(config.ollamaApiKey).toBe("sk-ollama");
  });

  it("supports a separate evaluator model for deterministic post-turn checks", () => {
    const config = loadConfig(env({ CHAT_MODEL: "main-model", EVALUATOR_MODEL: "eval-model" }));
    expect(config.chatModel).toBe("main-model");
    expect(config.evaluatorModel).toBe("eval-model");
  });

  it("defaults evaluator model to DeepSeek v4 Flash independent of the main chat model", () => {
    const config = loadConfig(env({ CHAT_MODEL: "main-model" }));
    expect(config.evaluatorModel).toBe("deepseek/deepseek-v4-flash");
  });

  it("defaults ollamaApiKey to empty string", () => {
    const config = loadConfig(env({ PROVIDER: "ollama" }));
    expect(config.ollamaApiKey).toBe("");
  });


  it("does not require OPENROUTER_API_KEY when PROVIDER=ollama", () => {
    expect(() =>
      loadConfig(env({ PROVIDER: "ollama", OPENROUTER_API_KEY: undefined }))
    ).not.toThrow();
  });

  it("still requires OPENROUTER_API_KEY for openrouter provider", () => {
    expect(() =>
      loadConfig(env({ PROVIDER: "openrouter", OPENROUTER_API_KEY: undefined }))
    ).toThrow("OPENROUTER_API_KEY");
  });

  it("still requires OPENROUTER_API_KEY when PROVIDER is unset (default openrouter)", () => {
    expect(() =>
      loadConfig(env({ PROVIDER: undefined, OPENROUTER_API_KEY: undefined }))
    ).toThrow("OPENROUTER_API_KEY");
  });

});

describe("provider creation", () => {
  it("creates OllamaProvider when provider is ollama", () => {
    const config = loadConfig(env({ PROVIDER: "ollama" }));
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it("creates OpenRouterProvider when provider is openrouter", () => {
    const config = loadConfig(env({}));
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });


  it("passes OpenRouter config to chat and complete calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider({
      apiKey: "sk-openrouter",
      model: "eval-model",
      baseUrl: "https://openrouter.test/api/v1",
    });
    await provider.complete("system", "user");

    const url = fetchMock.mock.calls[0][0];
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(url).toBe("https://openrouter.test/api/v1/chat/completions");
    expect(body.model).toBe("eval-model");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-openrouter");
  });

  it("passes ollama config to the provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = loadConfig(
      env({
        PROVIDER: "ollama",
        OLLAMA_BASE_URL: "http://192.168.1.5:11434/v1",
        OLLAMA_MODEL: "llama3.1:8b",
        OLLAMA_API_KEY: "sk-secret",
      }),
    );
    const provider = createProvider(config) as OllamaProvider;
    await provider.chat([{ role: "user", content: "hi" }]);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe("http://192.168.1.5:11434/v1/chat/completions");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("llama3.1:8b");

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-secret");
  });

});
