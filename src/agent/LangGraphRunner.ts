import type { ChatMessage } from "../llm.js";
import type { ToolContext, ToolDefinition } from "../tools/index.js";
import { createTools, toolsToOpenAI } from "../tools/index.js";
import { callTool } from "./ToolExecutor.js";
import { logger } from "../infrastructure/logger.js";
import { PostTurnProcessor } from "./PostTurnProcessor.js";
import { buildConversationPlan } from "./ConversationPlanner.js";
import type { AgentDeps, AgentResult, AgentRunOptions } from "./AgentRunner.js";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const log = logger.child({ ctx: "agent", runtime: "langgraph" });
const MAX_TOOL_ITERATIONS = 10;

type NextStep = "llm" | "tools" | "post_turn" | "done";

interface TurnState {
  traceId: string;
  userMessage: string;
  chatHistory: ChatMessage[];
  options: AgentRunOptions;
  messages: ChatMessage[];
  totalText: string;
  iteration: number;
  toolCallsMade: number;
  tools: Map<string, ToolDefinition>;
  next: NextStep;
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
  tools: Annotation<Map<string, ToolDefinition>>,
  next: Annotation<NextStep>,
});

export class LangGraphRunner {
  constructor(private deps: AgentDeps) {}

  private conversationTools(tools: Map<string, ToolDefinition>): Map<string, ToolDefinition> {
    const internalOnly = new Set([
      "miguelito_turn_annotate",
      "miguelito_error_log",
      "miguelito_progress_summary",
      "miguelito_interest_add",
    ]);
    return new Map(Array.from(tools.entries()).filter(([name]) => !internalOnly.has(name)));
  }

  private shouldRunPostTurn(state: TurnState): boolean {
    const { options } = state;
    return Boolean(
      state.totalText.trim() &&
        options.postTurn !== false &&
        options.sourceType !== "cron" &&
        options.sourceType !== "proactive" &&
        options.sourceType !== "system",
    );
  }

  private buildGraph() {
    const prepare = async (state: TurnState): Promise<Partial<TurnState>> => {
      const { promptBuilder, toolCtx, lang, dreamMemoryPath } = this.deps;
      const fullSystem = await promptBuilder.build(state.userMessage, dreamMemoryPath);
      const postHistoryReminder = promptBuilder.buildPostHistoryReminder();
      const conversationPlan = buildConversationPlan({ userMessage: state.userMessage, history: state.chatHistory });
      const tools = createTools(toolCtx, lang);
      const messages: ChatMessage[] = [
        { role: "system", content: fullSystem },
        ...state.chatHistory,
        { role: "user", content: state.userMessage },
        { role: "system", content: conversationPlan },
        { role: "system", content: postHistoryReminder },
      ];

      log.info(
        { traceId: state.traceId, node: "prepare", historyMessages: state.chatHistory.length, toolCount: tools.size },
        "langgraph node complete",
      );

      return { messages, tools, next: "llm" };
    };

    const llm = async (state: TurnState): Promise<Partial<TurnState>> => {
      const openaiTools = toolsToOpenAI(this.conversationTools(state.tools));
      log.debug(
        { traceId: state.traceId, node: "llm", iteration: state.iteration, maxIters: MAX_TOOL_ITERATIONS, toolCount: openaiTools.length },
        "langgraph llm call start",
      );

      const result = await this.deps.provider.chat(state.messages, openaiTools, {
        temperature: 0.7,
        maxTokens: 4096,
        stop: ["\nUser:", "\nLearner:", "\n<|im_start|>", "\n<|im_end|>"],
      });

      if (result.toolCalls.length === 0) {
        const totalText = result.content ?? "";
        const next: NextStep = this.shouldRunPostTurn({ ...state, totalText }) ? "post_turn" : "done";
        log.info(
          { traceId: state.traceId, node: "llm", iteration: state.iteration, responseLength: totalText.length, next },
          "langgraph node complete",
        );
        return { totalText, next };
      }

      if (state.iteration + 1 >= MAX_TOOL_ITERATIONS) {
        log.warn(
          { traceId: state.traceId, node: "llm", iteration: state.iteration, toolCalls: result.toolCalls.length },
          "langgraph max tool iterations reached",
        );
        return { totalText: result.content ?? "", next: "done" };
      }

      const messages = [
        ...state.messages,
        { role: "assistant" as const, content: result.content ?? "", tool_calls: result.toolCalls },
      ];

      log.info(
        { traceId: state.traceId, node: "llm", iteration: state.iteration, toolCalls: result.toolCalls.length, next: "tools" },
        "langgraph node complete",
      );

      return { messages, next: "tools" };
    };

    const toolsNode = async (state: TurnState): Promise<Partial<TurnState>> => {
      const last = state.messages[state.messages.length - 1];
      const toolCalls = last?.tool_calls ?? [];
      const toolResults = await Promise.all(toolCalls.map((tc) => callTool(tc, state.tools)));
      const toolCallsMade = state.toolCallsMade + toolResults.filter((tr) => tr.toolCalled).length;
      const messages = [...state.messages, ...toolResults];
      const iteration = state.iteration + 1;

      log.info(
        { traceId: state.traceId, node: "tools", iteration, toolCalls: toolCalls.length, toolCallsMade, next: "llm" },
        "langgraph node complete",
      );

      return { messages, iteration, toolCallsMade, next: "llm" };
    };

    const postTurn = async (state: TurnState): Promise<Partial<TurnState>> => {
      const { provider, toolCtx, lang } = this.deps;
      const evaluatorProvider = this.deps.evaluatorProvider ?? provider;
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

      log.info({ traceId: state.traceId, node: "post_turn", next: "done" }, "langgraph node complete");
      return { next: "done" };
    };

    return new StateGraph(TurnStateAnnotation)
      .addNode("prepare", prepare)
      .addNode("llm", llm)
      .addNode("tools", toolsNode)
      .addNode("post_turn", postTurn)
      .addEdge(START, "prepare")
      .addConditionalEdges("prepare", (state) => state.next, { llm: "llm" })
      .addConditionalEdges("llm", (state) => state.next, { tools: "tools", post_turn: "post_turn", done: END })
      .addConditionalEdges("tools", (state) => state.next, { llm: "llm" })
      .addConditionalEdges("post_turn", (state) => state.next, { done: END })
      .compile();
  }

  async run(userMessage: string, chatHistory: ChatMessage[], options: AgentRunOptions = {}): Promise<AgentResult> {
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const graph = this.buildGraph();
    const initialState: TurnState = {
      traceId,
      userMessage,
      chatHistory,
      options,
      messages: [],
      totalText: "",
      iteration: 0,
      toolCallsMade: 0,
      tools: new Map(),
      next: "llm",
    };

    log.info({ traceId }, "langgraph run start");
    const finalState = await graph.invoke(initialState, { recursionLimit: MAX_TOOL_ITERATIONS * 3 + 8 }) as TurnState;
    log.info(
      { traceId, totalIters: finalState.iteration + 1, toolCallsMade: finalState.toolCallsMade, responseLength: finalState.totalText.length },
      "langgraph run complete",
    );

    return { text: finalState.totalText, toolCallsMade: finalState.toolCallsMade };
  }
}
