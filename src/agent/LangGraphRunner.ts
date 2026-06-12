import type { ChatMessage } from "../llm.js";
import type { ToolDefinition } from "../tools/index.js";
import { createTools, toolsToOpenAI } from "../tools/index.js";
import { callTool } from "./ToolExecutor.js";
import { logger } from "../infrastructure/logger.js";
import { PostTurnProcessor } from "./PostTurnProcessor.js";
import { buildConversationPlan } from "./ConversationPlanner.js";
import type { AgentDeps, AgentResult, AgentRunOptions } from "./types.js";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const log = logger.child({ ctx: "agent", runtime: "langgraph" });
const MAX_TOOL_ITERATIONS = 10;

type NextStep = "llm" | "tools" | "post_turn" | "done";
type NodeName = "start" | "prepare" | "llm" | "tools" | "post_turn" | "done";

export interface LangGraphTransition {
  runtime: "langgraph";
  traceId: string;
  at: string;
  from: NodeName;
  to: NodeName;
  reason: string;
  iteration: number;
  messageCount: number;
  toolCallsMade: number;
  responseLength: number;
  toolCallCount?: number;
}

export interface LangGraphRunnerOptions {
  onTransition?: (transition: LangGraphTransition) => void;
}

export interface LangGraphTurnState {
  traceId: string;
  userMessage: string;
  chatHistory: ChatMessage[];
  options: AgentRunOptions;
  messages: ChatMessage[];
  totalText: string;
  iteration: number;
  toolCallsMade: number;
  toolRegistry: Map<string, ToolDefinition>;
  next: NextStep;
  transitionReason: string;
}

const TurnStateAnnotation = Annotation.Root({
  traceId: Annotation<string>,
  userMessage: Annotation<string>,
  chatHistory: Annotation<ChatMessage[]>,
  options: Annotation<AgentRunOptions>,
  messages: Annotation<ChatMessage[]>,
  totalText: Annotation<string>,
  iteration: Annotation<number>,
  toolCallsMade: Annotation<number>,
  toolRegistry: Annotation<Map<string, ToolDefinition>>,
  next: Annotation<NextStep>,
  transitionReason: Annotation<string>,
});

function conversationTools(tools: Map<string, ToolDefinition>): Map<string, ToolDefinition> {
  const internalOnly = new Set([
    "miguelito_turn_annotate",
    "miguelito_error_log",
    "miguelito_progress_summary",
    "miguelito_interest_add",
  ]);
  return new Map(Array.from(tools.entries()).filter(([name]) => !internalOnly.has(name)));
}

function shouldRunPostTurn(state: Pick<LangGraphTurnState, "totalText" | "options">): boolean {
  const { options } = state;
  return Boolean(
    state.totalText.trim() &&
      options.postTurn !== false &&
      options.sourceType !== "cron" &&
      options.sourceType !== "proactive" &&
      options.sourceType !== "system",
  );
}

function nextNode(next: NextStep): NodeName {
  return next === "tools" ? "tools" : next;
}

function emitTransition(
  options: LangGraphRunnerOptions,
  state: LangGraphTurnState,
  from: NodeName,
  to: NodeName,
  reason: string,
  extra: Pick<Partial<LangGraphTransition>, "toolCallCount"> = {},
): void {
  const transition: LangGraphTransition = {
    runtime: "langgraph",
    traceId: state.traceId,
    at: new Date().toISOString(),
    from,
    to,
    reason,
    iteration: state.iteration,
    messageCount: state.messages.length,
    toolCallsMade: state.toolCallsMade,
    responseLength: state.totalText.length,
    ...extra,
  };
  log.info(transition, "langgraph transition");
  options.onTransition?.(transition);
}

export function createInitialLangGraphState(
  userMessage: string,
  chatHistory: ChatMessage[],
  options: AgentRunOptions,
): LangGraphTurnState {
  return {
    traceId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    userMessage,
    chatHistory,
    options,
    messages: [],
    totalText: "",
    iteration: 0,
    toolCallsMade: 0,
    toolRegistry: new Map(),
    next: "llm",
    transitionReason: "start",
  };
}

export async function prepareLangGraphTurn(deps: AgentDeps, state: LangGraphTurnState): Promise<Partial<LangGraphTurnState>> {
  const { promptBuilder, toolCtx, lang, dreamMemoryPath } = deps;
  const fullSystem = await promptBuilder.build(state.userMessage, dreamMemoryPath);
  const postHistoryReminder = promptBuilder.buildPostHistoryReminder();
  const conversationPlan = buildConversationPlan({ userMessage: state.userMessage, history: state.chatHistory });
  const toolRegistry = createTools(toolCtx, lang);
  const messages: ChatMessage[] = [
    { role: "system", content: fullSystem },
    ...state.chatHistory,
    { role: "user", content: state.userMessage },
    { role: "system", content: conversationPlan },
    { role: "system", content: postHistoryReminder },
  ];

  return { messages, toolRegistry, next: "llm", transitionReason: "prepared_turn" };
}

export async function callLangGraphLlm(deps: AgentDeps, state: LangGraphTurnState): Promise<Partial<LangGraphTurnState>> {
  const openaiTools = toolsToOpenAI(conversationTools(state.toolRegistry));
  log.debug(
    { traceId: state.traceId, node: "llm", iteration: state.iteration, maxIters: MAX_TOOL_ITERATIONS, toolCount: openaiTools.length },
    "langgraph llm call start",
  );

  const result = await deps.provider.chat(state.messages, openaiTools, {
    temperature: 0.7,
    maxTokens: 4096,
    stop: ["\nUser:", "\nLearner:", "\n<|im_start|>", "\n<|im_end|>"],
  });

  if (result.toolCalls.length === 0) {
    const totalText = result.content ?? "";
    return {
      totalText,
      next: shouldRunPostTurn({ ...state, totalText }) ? "post_turn" : "done",
      transitionReason: totalText.trim() ? "assistant_reply" : "empty_reply",
    };
  }

  if (state.iteration + 1 >= MAX_TOOL_ITERATIONS) {
    return {
      totalText: result.content ?? "",
      next: "done",
      transitionReason: "max_tool_iterations",
    };
  }

  return {
    messages: [
      ...state.messages,
      { role: "assistant", content: result.content ?? "", tool_calls: result.toolCalls },
    ],
    next: "tools",
    transitionReason: "tool_calls_requested",
  };
}

export async function runLangGraphTools(state: LangGraphTurnState): Promise<Partial<LangGraphTurnState>> {
  const last = state.messages[state.messages.length - 1];
  const toolCalls = last?.tool_calls ?? [];
  const toolResults = await Promise.all(toolCalls.map((tc) => callTool(tc, state.toolRegistry)));
  return {
    messages: [...state.messages, ...toolResults],
    iteration: state.iteration + 1,
    toolCallsMade: state.toolCallsMade + toolResults.filter((tr) => tr.toolCalled).length,
    next: "llm",
    transitionReason: "tools_completed",
  };
}

export function scheduleLangGraphPostTurn(deps: AgentDeps, state: LangGraphTurnState): Partial<LangGraphTurnState> {
  const { provider, toolCtx, lang } = deps;
  const evaluatorProvider = deps.evaluatorProvider ?? provider;
  const processor = new PostTurnProcessor({
    provider: evaluatorProvider,
    errors: toolCtx.errors,
    competency: toolCtx.competency,
    session: toolCtx.session,
    interests: toolCtx.interests,
    learning: toolCtx.learning,
    lang,
  });

  processor.process({ userMessage: state.userMessage, assistantText: state.totalText, chatHistory: state.chatHistory }).catch((err) =>
    log.warn({ err, traceId: state.traceId }, "post-turn evaluation failed"),
  );

  return { next: "done", transitionReason: "post_turn_scheduled" };
}

export class LangGraphRunner {
  constructor(private deps: AgentDeps, private options: LangGraphRunnerOptions = {}) {}

  private buildGraph() {
    return new StateGraph(TurnStateAnnotation)
      .addNode("prepare", async (state: LangGraphTurnState) => {
        const update = await prepareLangGraphTurn(this.deps, state);
        const next = nextNode(update.next ?? "llm");
        emitTransition(this.options, { ...state, ...update } as LangGraphTurnState, "prepare", next, update.transitionReason ?? "prepared_turn");
        return update;
      })
      .addNode("llm", async (state: LangGraphTurnState) => {
        const update = await callLangGraphLlm(this.deps, state);
        const updated = { ...state, ...update } as LangGraphTurnState;
        const lastToolCalls = updated.messages[updated.messages.length - 1]?.tool_calls?.length;
        emitTransition(this.options, updated, "llm", nextNode(updated.next), updated.transitionReason, { toolCallCount: lastToolCalls });
        return update;
      })
      .addNode("tools", async (state: LangGraphTurnState) => {
        const update = await runLangGraphTools(state);
        emitTransition(this.options, { ...state, ...update } as LangGraphTurnState, "tools", "llm", update.transitionReason ?? "tools_completed");
        return update;
      })
      .addNode("post_turn", (state: LangGraphTurnState) => {
        const update = scheduleLangGraphPostTurn(this.deps, state);
        emitTransition(this.options, { ...state, ...update } as LangGraphTurnState, "post_turn", "done", update.transitionReason ?? "post_turn_scheduled");
        return update;
      })
      .addEdge(START, "prepare")
      .addConditionalEdges("prepare", (state) => state.next, { llm: "llm" })
      .addConditionalEdges("llm", (state) => state.next, { tools: "tools", post_turn: "post_turn", done: END })
      .addConditionalEdges("tools", (state) => state.next, { llm: "llm" })
      .addConditionalEdges("post_turn", (state) => state.next, { done: END })
      .compile();
  }

  async run(userMessage: string, chatHistory: ChatMessage[], options: AgentRunOptions = {}): Promise<AgentResult> {
    const initialState = createInitialLangGraphState(userMessage, chatHistory, options);
    const graph = this.buildGraph();

    log.info({ traceId: initialState.traceId }, "langgraph run start");
    emitTransition(this.options, initialState, "start", "prepare", "run_started");
    const finalState = await graph.invoke(initialState, { recursionLimit: MAX_TOOL_ITERATIONS * 3 + 8 }) as LangGraphTurnState;
    log.info(
      { traceId: finalState.traceId, totalIters: finalState.iteration + 1, toolCallsMade: finalState.toolCallsMade, responseLength: finalState.totalText.length },
      "langgraph run complete",
    );

    return { text: finalState.totalText, toolCallsMade: finalState.toolCallsMade };
  }
}
