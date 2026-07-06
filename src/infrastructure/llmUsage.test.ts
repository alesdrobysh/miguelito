import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "../test/dbHelpers.js";

describe("BuddyDb LLM usage tracking", () => {
  let handle: TestDbHandle | undefined;
  afterEach(() => handle?.cleanup());

  it("stores usage rows and aggregates them by user, day, purpose, and model", async () => {
    handle = await createTestDb();
    const db = handle.db;
    const user2 = await db.ensureExternalUser("telegram", "alice");
    const scoped = db.withUserId(user2).withLanguage("spanish", [], []);

    await scoped.recordLlmUsage({
      userId: user2,
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
      userId: user2,
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
      SELECT users.external_user_id, date(llm_usage.created_at), purpose, model,
             ROUND(SUM(cost_usd), 6), SUM(total_tokens), COUNT(*)
      FROM llm_usage JOIN users ON users.id = llm_usage.user_id
      GROUP BY users.external_user_id, date(llm_usage.created_at), purpose, model
      ORDER BY purpose
    `)[0]?.values ?? [];

    expect(rows).toEqual([
      ["alice", expect.any(String), "chat", "chat-model", 0.002, 150, 1],
      ["alice", expect.any(String), "evaluator", "eval-model", 0.0003, 30, 1],
    ]);
  });
});
