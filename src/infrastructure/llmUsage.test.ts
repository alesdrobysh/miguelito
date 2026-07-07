import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "../test/dbHelpers.js";

describe("BuddyDb LLM usage tracking", () => {
  let handle: TestDbHandle | undefined;
  afterEach(() => handle?.cleanup());

  it("stores usage rows and aggregates them by day, purpose, and model", async () => {
    handle = await createTestDb();
    const db = handle.db;
    const scoped = db.withLanguage("spanish", [], []);

    await scoped.recordLlmUsage({
      userId: 1,
      language: "spanish",
      provider: "openrouter",
      model: "chat-model",
      purpose: "chat",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0.002,
      latencyMs: 1200,
    });
    await scoped.recordLlmUsage({
      userId: 1,
      language: "spanish",
      provider: "openrouter",
      model: "eval-model",
      purpose: "evaluator",
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      costUsd: 0.0003,
      latencyMs: 300,
    });

    const rows = db.db.exec(`
      SELECT date(llm_usage.created_at), purpose, model,
             ROUND(SUM(cost_usd), 6), SUM(total_tokens), COUNT(*)
      FROM llm_usage
      GROUP BY date(llm_usage.created_at), purpose, model
      ORDER BY purpose
    `)[0]?.values ?? [];

    expect(rows).toEqual([
      [expect.any(String), "chat", "chat-model", 0.002, 150, 1],
      [expect.any(String), "evaluator", "eval-model", 0.0003, 30, 1],
    ]);
  });
});
