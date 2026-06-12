import type { ChatMessage } from "../llm.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { SessionRepository } from "../repositories/interfaces.js";
import type { ToolContext, ToolDefinition } from "../tools/index.js";
import { createTools, toolsToOpenAI } from "../tools/index.js";
import { callTool } from "./ToolExecutor.js";
import type { PromptBuilder } from "./PromptBuilder.js";
import { logger } from "../infrastructure/logger.js";
import { PostTurnProcessor } from "./PostTurnProcessor.js";
import { buildConversationPlan } from "./ConversationPlanner.js";
import { TurnGraph } from "./TurnGraph.js";

const log = logger.child({ ctx: "agent", runtime: "internal-graph" });
const MAX_TOOL_ITERATIONS = 10;

type NextStep = "llm" | "tools" | "post_turn" | "done";
type NodeName = "prepare" | "llm" | "tools" | "post_turn";

export interface AgentDeps {
  provider: LLMProvider;
  evaluatorProvider?: LLMProvider;
  session: SessionRepository;
  promptBuilder: PromptBuilder;
  toolCtx: ToolContext;
  lang: LanguageConfig;
  dreamMemoryPath?: string;
}

export interface AgentResult {
  text: string;
  toolCallsMade: number;
}

export interface AgentRunOptions {
  postTurn?: boolean;
  sourceType?: "user_chat" | "cron" | "proactive" | "system";
}

export interface AgentTransition {
  runtime: "internal-graph";
  traceId: string;
  at: string;
  from: NodeName | "start";
  to: NodeName | "done";
  reason: string;
  iteration: number;
  messageCount: number;
  toolCallsMade: number;
  responseLength: number;
  toolCallCount?: number;
}

export interface AgentRunnerOptions {
  onTransition?: (transition: AgentTransition) => void;
}

export interface AgentTurnState {
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

function conversationTools(tools: Map<string, ToolDefinition>): Map<string, ToolDefinition> {
  const internalOnly = new Set([
    "miguelito_turn_annotate",
    "miguelito_error_log",
    "miguelito_progress_summary",
    "miguelito_interest_add",
  ]);
  return new Map(Array.from(tools.entries()).filter(([name]) => !internalOnly.has(name)));
}

function shouldRunPostTurn(state: Pick<AgentTurnState, "totalText" | "options">): boolean {
  const { options } = state;
  return Boolean(
    state.totalText.trim() &&
      options.postTurn !== false &&
      options.sourceType !== "cron" &&
      options.sourceType !== "proactive" &&
      options.sourceType !== "system",
  );
}

function nextNode(next: NextStep): NodeName | "done" {
  return next === "tools" ? "tools" : next;
}

function emitTransition(
  options: AgentRunnerOptions,
  state: AgentTurnState,
  from: NodeName | "start",
  to: NodeName | "done",
  reason: string,
  extra: Pick<Partial<AgentTransition>, "toolCallCount"> = {},
): void {
  const transition: AgentTransition = {
    runtime: "internal-graph",
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
  log.info(transition, "agent graph transition");
  options.onTransition?.(transition);
}

export function createInitialAgentState(userMessage: string, chatHistory: ChatMessage[], options: AgentRunOptions): AgentTurnState {
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

export async function prepareAgentTurn(deps: AgentDeps, state: AgentTurnState): Promise<Partial<AgentTurnState>> {
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

export async function callAgentLlm(deps: AgentDeps, state: AgentTurnState): Promise<Partial<AgentTurnState>> {
  const openaiTools = toolsToOpenAI(conversationTools(state.toolRegistry));
  log.debug(
    { traceId: state.traceId, node: "llm", iteration: state.iteration, maxIters: MAX_TOOL_ITERATIONS, toolCount: openaiTools.length },
    "agent graph llm call start",
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

export async function runAgentTools(state: AgentTurnState): Promise<Partial<AgentTurnState>> {
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

export function scheduleAgentPostTurn(deps: AgentDeps, state: AgentTurnState): Partial<AgentTurnState> {
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

function applyUpdate(state: AgentTurnState, update: Partial<AgentTurnState>): AgentTurnState {
  return { ...state, ...update };
}

export class AgentRunner {
  private readonly graph: TurnGraph<AgentTurnState, NodeName>;

  constructor(private deps: AgentDeps, private options: AgentRunnerOptions = {}) {
    this.graph = new TurnGraph<AgentTurnState, NodeName>("prepare", [
      {
        name: "prepare",
        run: async (state) => {
          const update = await prepareAgentTurn(this.deps, state);
          const updated = applyUpdate(state, update);
          emitTransition(this.options, updated, "prepare", nextNode(updated.next), updated.transitionReason);
          return updated;
        },
        route: (state) => nextNode(state.next),
        reason: (state) => state.transitionReason,
        summarize: (state) => ({ messages: state.messages.length, tools: state.toolRegistry.size, next: state.next }),
      },
      {
        name: "llm",
        run: async (state) => {
          const update = await callAgentLlm(this.deps, state);
          const updated = applyUpdate(state, update);
          const lastToolCalls = updated.messages[updated.messages.length - 1]?.tool_calls?.length;
          emitTransition(this.options, updated, "llm", nextNode(updated.next), updated.transitionReason, { toolCallCount: lastToolCalls });
          return updated;
        },
        route: (state) => nextNode(state.next),
        reason: (state) => state.transitionReason,
        summarize: (state) => ({
          iteration: state.iteration,
          messages: state.messages.length,
          toolCallsMade: state.toolCallsMade,
          responseLength: state.totalText.length,
          next: state.next,
        }),
      },
      {
        name: "tools",
        run: async (state) => {
          const update = await runAgentTools(state);
          const updated = applyUpdate(state, update);
          emitTransition(this.options, updated, "tools", "llm", updated.transitionReason);
          return updated;
        },
        route: (state) => nextNode(state.next),
        reason: (state) => state.transitionReason,
        summarize: (state) => ({ iteration: state.iteration, messages: state.messages.length, toolCallsMade: state.toolCallsMade, next: state.next }),
      },
      {
        name: "post_turn",
        run: (state) => {
          const update = scheduleAgentPostTurn(this.deps, state);
          const updated = applyUpdate(state, update);
          emitTransition(this.options, updated, "post_turn", "done", updated.transitionReason);
          return updated;
        },
        route: (state) => nextNode(state.next),
        reason: (state) => state.transitionReason,
        summarize: (state) => ({ responseLength: state.totalText.length, toolCallsMade: state.toolCallsMade, next: state.next }),
      },
    ]);
  }

  async run(userMessage: string, chatHistory: ChatMessage[], options: AgentRunOptions = {}): Promise<AgentResult> {
    const initialState = createInitialAgentState(userMessage, chatHistory, options);

    log.info({ traceId: initialState.traceId }, "agent graph run start");
    emitTransition(this.options, initialState, "start", "prepare", "run_started");
    const { state: finalState, trace } = await this.graph.run(initialState, initialState.traceId, { maxSteps: MAX_TOOL_ITERATIONS * 3 + 8 });
    log.info(
      {
        traceId: finalState.traceId,
        nodes: trace.events.map((event) => `${event.from}->${event.to}:${event.durationMs}ms`),
        totalIters: finalState.iteration + 1,
        toolCallsMade: finalState.toolCallsMade,
        responseLength: finalState.totalText.length,
      },
      "agent graph run complete",
    );

    return { text: finalState.totalText, toolCallsMade: finalState.toolCallsMade };
  }
}
