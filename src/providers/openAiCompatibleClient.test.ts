import { describe, it, expect, afterEach, vi } from "vitest";
import { chatCompletion } from "./openAiCompatibleClient.js";

function mockFetch(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(""),
  });
}

describe("chatCompletion cost tracking", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns OpenRouter token usage and cost when the response includes it", async () => {
    vi.stubGlobal("fetch", mockFetch({
      choices: [{ message: { content: "hola" } }],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 45,
        total_tokens: 168,
        cost: 0.00042,
      },
    }));

    const result = await chatCompletion(
      { apiKey: "key", baseUrl: "https://openrouter.ai/api/v1", model: "cheap/model", providerName: "openrouter" },
      [{ role: "user", content: "hi" }],
    );

    expect(result.usage).toEqual({
      promptTokens: 123,
      completionTokens: 45,
      totalTokens: 168,
      costUsd: 0.00042,
    });
  });
});
