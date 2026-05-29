import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import type { LLMProvider, ChatMessage, ChatResult, ChatOptions } from "../providers/interfaces.js";
import { AgentRunner } from "./AgentRunner.js";
import type { PromptBuilder } from "./PromptBuilder.js";

class ChatProvider implements LLMProvider {
  public chatCalls = 0;
  public lastTools: object[] | undefined;
  constructor(private content: string) {}
  async chat(_messages: ChatMessage[], tools?: object[], _opts?: ChatOptions): Promise<ChatResult> {
    this.chatCalls++;
    this.lastTools = tools;
    return { content: this.content, toolCalls: [] };
  }
  async complete(): Promise<string> { throw new Error("main provider should not evaluate"); }
  async completeJson<T>(): Promise<T> { throw new Error("main provider should not evaluate"); }
}

class EvaluatorProvider implements LLMProvider {
  public completeJsonCalls = 0;
  async chat(): Promise<ChatResult> { throw new Error("evaluator should not chat"); }
  async complete(): Promise<string> { throw new Error("unused"); }
  async completeJson<T>(_system: string | null, _user: string, opts?: ChatOptions): Promise<T> {
    this.completeJsonCalls++;
    expect(opts?.temperature).toBe(0);
    return {
      annotation: { obligatory: [], used: [], naturalness: 1, comprehension: "smooth" },
      mode: "OFFER",
      errors: [],
      vocabulary: [],
      reviews: [],
    } as T;
  }
}

let db: BuddyDb;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-agent-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"), "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("AgentRunner post-turn evaluation", () => {
  it("uses a separate deterministic evaluator provider after the chat provider replies", async () => {
    const main = new ChatProvider("Vale, seguimos.");
    const evaluator = new EvaluatorProvider();
    const promptBuilder = {
      build: async () => "system",
      buildPostHistoryReminder: () => "reminder",
    } as unknown as PromptBuilder;
    const toolCtx = { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, provider: main };

    const runner = new AgentRunner({ provider: main, evaluatorProvider: evaluator, session: db, promptBuilder, toolCtx, lang: SpanishLanguage });
    const result = await runner.run("hola", []);

    expect(result.text).toBe("Vale, seguimos.");
    expect(main.chatCalls).toBe(1);
    expect(evaluator.completeJsonCalls).toBe(1);
    expect((await db.getRecentAnnotations(10))).toHaveLength(1);
    expect((await db.getConversationState()).session.last_mode).toBe("OFFER");
  });

  it("does not expose post-turn learning side-effect tools to the chat model", async () => {
    const main = new ChatProvider("Vale.");
    const evaluator = new EvaluatorProvider();
    const promptBuilder = {
      build: async () => "system",
      buildPostHistoryReminder: () => "reminder",
    } as unknown as PromptBuilder;
    const toolCtx = { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, provider: main };

    const runner = new AgentRunner({ provider: main, evaluatorProvider: evaluator, session: db, promptBuilder, toolCtx, lang: SpanishLanguage });
    await runner.run("hola", []);

    const names = ((main.lastTools ?? []) as any[]).map((t) => t.function.name);
    expect(names).not.toContain("miguelito_turn_annotate");
    expect(names).not.toContain("miguelito_error_log");
    expect(names).not.toContain("miguelito_vocab_add");
    expect(names).not.toContain("miguelito_vocab_score");
    expect(names).not.toContain("miguelito_vocab_attempt_start");
    expect(names).not.toContain("miguelito_vocab_attempt_finish");
    expect(names).not.toContain("miguelito_progress_summary");
  });
});
