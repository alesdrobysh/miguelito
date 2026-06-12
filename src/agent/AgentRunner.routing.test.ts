import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import type { ChatMessage, ToolCall } from "../llm.js";
import type { ChatOptions, ChatResult, LLMProvider } from "../providers/interfaces.js";
import type { PromptBuilder } from "./PromptBuilder.js";
import { AgentRunner, type AgentTransition } from "./AgentRunner.js";

function toolCall(id: string): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "unknown_test_tool",
      arguments: "{}",
    },
  };
}

class ScriptedProvider implements LLMProvider {
  public chatCalls: ChatMessage[][] = [];
  constructor(private responses: ChatResult[]) {}

  async chat(messages: ChatMessage[], _tools?: object[], _opts?: ChatOptions): Promise<ChatResult> {
    this.chatCalls.push(messages);
    return this.responses.shift() ?? { content: "fallback", toolCalls: [] };
  }

  async complete(): Promise<string> { throw new Error("main provider should not complete"); }
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-agent-routing-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"), "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createRunner(provider: LLMProvider, evaluator: EvaluatorProvider, transitions: AgentTransition[]) {
  const promptBuilder = {
    build: async () => "system",
    buildPostHistoryReminder: () => "reminder",
  } as unknown as PromptBuilder;
  const toolCtx = { errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider };
  return new AgentRunner(
    { provider, evaluatorProvider: evaluator, session: db, promptBuilder, toolCtx, lang: SpanishLanguage },
    { onTransition: (transition) => transitions.push(transition) },
  );
}

describe("AgentRunner graph routing", () => {
  it("routes no-tool replies to post_turn for normal user chat", async () => {
    const transitions: AgentTransition[] = [];
    const provider = new ScriptedProvider([{ content: "Vale, seguimos.", toolCalls: [] }]);
    const evaluator = new EvaluatorProvider();
    const runner = createRunner(provider, evaluator, transitions);

    const result = await runner.run("hola", []);

    expect(result).toEqual({ text: "Vale, seguimos.", toolCallsMade: 0 });
    expect(provider.chatCalls).toHaveLength(1);
    await expect.poll(() => evaluator.completeJsonCalls).toBe(1);
    expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "start->prepare",
      "prepare->llm",
      "llm->post_turn",
      "post_turn->done",
    ]);
    expect(transitions.every((t) => t.traceId && typeof t.at === "string" && t.runtime === "internal-graph")).toBe(true);
  }, 15_000);

  it("routes no-tool cron/proactive/system replies directly to done", async () => {
    for (const sourceType of ["cron", "proactive", "system"] as const) {
      const transitions: AgentTransition[] = [];
      const provider = new ScriptedProvider([{ content: `reply:${sourceType}`, toolCalls: [] }]);
      const evaluator = new EvaluatorProvider();
      const runner = createRunner(provider, evaluator, transitions);

      const result = await runner.run("background", [], { sourceType });

      expect(result.text).toBe(`reply:${sourceType}`);
      expect(evaluator.completeJsonCalls).toBe(0);
      expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
        "start->prepare",
        "prepare->llm",
        "llm->done",
      ]);
    }
  });

  it("routes tool calls through tools and back to llm", async () => {
    const transitions: AgentTransition[] = [];
    const provider = new ScriptedProvider([
      { content: "", toolCalls: [toolCall("call-1")] },
      { content: "Hecho.", toolCalls: [] },
    ]);
    const evaluator = new EvaluatorProvider();
    const runner = createRunner(provider, evaluator, transitions);

    const result = await runner.run("usa herramienta", [], { postTurn: false });

    expect(result.text).toBe("Hecho.");
    expect(provider.chatCalls).toHaveLength(2);
    expect(provider.chatCalls[1].some((m) => m.role === "tool" && m.tool_call_id === "call-1")).toBe(true);
    expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "start->prepare",
      "prepare->llm",
      "llm->tools",
      "tools->llm",
      "llm->done",
    ]);
  });

  it("stops safely at the max tool iteration limit", async () => {
    const transitions: AgentTransition[] = [];
    const provider = new ScriptedProvider(
      Array.from({ length: 12 }, (_, i) => ({ content: `tool-loop-${i}`, toolCalls: [toolCall(`call-${i}`)] })),
    );
    const evaluator = new EvaluatorProvider();
    const runner = createRunner(provider, evaluator, transitions);

    const result = await runner.run("loop forever", [], { postTurn: false });

    expect(result.text).toBe("tool-loop-9");
    expect(provider.chatCalls).toHaveLength(10);
    expect(transitions.at(-1)).toMatchObject({ from: "llm", to: "done", reason: "max_tool_iterations" });
    expect(transitions.filter((t) => t.to === "tools")).toHaveLength(9);
  });
});
