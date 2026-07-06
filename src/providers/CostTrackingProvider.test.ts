import { describe, it, expect } from "vitest";
import type { ChatMessage, ChatOptions, ChatResult, LLMProvider, LlmUsageInput } from "./interfaces.js";
import { CostTrackingProvider } from "./CostTrackingProvider.js";

class FakeProvider implements LLMProvider {
  async chat(_messages: ChatMessage[], _tools?: object[], _opts?: ChatOptions): Promise<ChatResult> {
    return {
      content: "ok",
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 },
    };
  }
  async complete(): Promise<string> { return "ok"; }
  async completeJson<T>(): Promise<T> { return { ok: true } as T; }
}

describe("CostTrackingProvider", () => {
  it("records usage with user, language, model, and purpose", async () => {
    const rows: LlmUsageInput[] = [];
    const provider = new CostTrackingProvider(new FakeProvider(), (row) => { rows.push(row); }, {
      userId: 2,
      language: "spanish",
      provider: "openrouter",
      model: "chat-model",
      purpose: "chat",
    });

    await provider.chat([{ role: "user", content: "hola" }]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 2,
      language: "spanish",
      provider: "openrouter",
      model: "chat-model",
      purpose: "chat",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUsd: 0.001,
    });
    expect(rows[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("lets call options override the default purpose", async () => {
    const rows: LlmUsageInput[] = [];
    const provider = new CostTrackingProvider(new FakeProvider(), (row) => { rows.push(row); }, {
      userId: 2,
      language: "spanish",
      provider: "openrouter",
      model: "eval-model",
      purpose: "evaluator",
    });

    await provider.chat([{ role: "user", content: "dream" }], undefined, { costContext: { purpose: "dream" } });

    expect(rows[0].purpose).toBe("dream");
  });
});
