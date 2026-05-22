import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig } from "../infrastructure/config.js";
import { createEvaluatorProvider, createProvider } from "../runtime.js";
import { OllamaProvider } from "./OllamaProvider.js";
import { OpenRouterProvider } from "./OpenRouterProvider.js";
import { OpenAICodexProvider } from "./OpenAICodexProvider.js";

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

  it("reads PROVIDER=openai-codex", () => {
    const config = loadConfig(env({ PROVIDER: "openai-codex", OPENAI_CODEX_API_KEY: "sk-codex" }));
    expect(config.provider).toBe("openai-codex");
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
    const config = loadConfig(env({ OPENROUTER_MODEL: "main-model", EVALUATOR_MODEL: "eval-model" }));
    expect(config.openrouterModel).toBe("main-model");
    expect(config.evaluatorModel).toBe("eval-model");
  });

  it("defaults evaluator model to the main OpenRouter model", () => {
    const config = loadConfig(env({ OPENROUTER_MODEL: "main-model" }));
    expect(config.evaluatorModel).toBe("main-model");
  });

  it("defaults ollamaApiKey to empty string", () => {
    const config = loadConfig(env({ PROVIDER: "ollama" }));
    expect(config.ollamaApiKey).toBe("");
  });

  it("reads OpenAI Codex config and falls back to OPENAI_API_KEY", () => {
    const config = loadConfig(env({
      PROVIDER: "openai-codex",
      OPENAI_API_KEY: "sk-openai",
      OPENAI_CODEX_MODEL: "gpt-codex-main",
      OPENAI_CODEX_EVALUATOR_MODEL: "gpt-codex-eval",
      OPENAI_CODEX_BASE_URL: "https://openai.test/v1",
    }));
    expect(config.openaiCodexApiKey).toBe("sk-openai");
    expect(config.openaiCodexModel).toBe("gpt-codex-main");
    expect(config.openaiCodexEvaluatorModel).toBe("gpt-codex-eval");
    expect(config.openaiCodexBaseUrl).toBe("https://openai.test/v1");
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

  it("requires an OpenAI key for the openai-codex provider", () => {
    expect(() =>
      loadConfig(env({ PROVIDER: "openai-codex", OPENAI_CODEX_API_KEY: undefined, OPENAI_API_KEY: undefined }))
    ).toThrow("OPENAI_CODEX_API_KEY or OPENAI_API_KEY");
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

  it("creates OpenAICodexProvider when provider is openai-codex", () => {
    const config = loadConfig(env({ PROVIDER: "openai-codex", OPENAI_CODEX_API_KEY: "sk-codex" }));
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(OpenAICodexProvider);
    expect(createEvaluatorProvider(config)).toBeInstanceOf(OpenAICodexProvider);
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

  it("passes OpenAI Codex config to chat and completeJson calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICodexProvider({
      apiKey: "sk-codex",
      model: "gpt-codex-eval",
      baseUrl: "https://openai.test/v1",
    });
    await provider.completeJson("system", "user", { maxTokens: 99 });

    const url = fetchMock.mock.calls[0][0];
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(url).toBe("https://openai.test/v1/chat/completions");
    expect(body.model).toBe("gpt-codex-eval");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(99);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-codex");
  });
});
