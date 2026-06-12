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

const log = logger.child({ ctx: 'agent' });

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

const MAX_TOOL_ITERATIONS = 10;

interface AgentTurnState {
  userMessage: string;
  chatHistory: ChatMessage[];
  options: AgentRunOptions;
  messages: ChatMessage[];
  tools: Map<string, ToolDefinition>;
  totalText: string;
  toolCallsMade: number;
  iterations: number;
}

export class AgentRunner {
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

  async run(userMessage: string, chatHistory: ChatMessage[], options: AgentRunOptions = {}): Promise<AgentResult> {
    const traceId = `agent-turn-${Date.now()}`;
    const graph = new TurnGraph<AgentTurnState>([
      {
        name: "prepare_prompt_and_tools",
        run: async (state) => this.preparePromptAndTools(state),
        summarize: (state) => ({ messages: state.messages.length, tools: state.tools.size }),
      },
      {
        name: "run_llm_tool_loop",
        run: async (state) => this.runLlmToolLoop(state),
        summarize: (state) => ({
          messages: state.messages.length,
          toolCallsMade: state.toolCallsMade,
          responseLength: state.totalText.length,
          next: state.totalText ? "post_turn_evaluation" : "return_empty",
        }),
      },
      {
        name: "schedule_post_turn_evaluation",
        run: async (state) => this.schedulePostTurnEvaluation(state),
        summarize: (state) => ({ responseLength: state.totalText.length, toolCallsMade: state.toolCallsMade }),
      },
    ]);

    const { state, trace } = await graph.run({
      userMessage,
      chatHistory,
      options,
      messages: [],
      tools: new Map(),
      totalText: "",
      toolCallsMade: 0,
      iterations: 0,
    }, traceId);

    log.info({
      traceId: trace.id,
      nodes: trace.events.map((event) => `${event.node}:${event.durationMs}ms`),
      totalIters: state.iterations,
      toolCallsMade: state.toolCallsMade,
      responseLength: state.totalText.length,
    }, 'run complete');

    return { text: state.totalText, toolCallsMade: state.toolCallsMade };
  }

  private async preparePromptAndTools(state: AgentTurnState): Promise<AgentTurnState> {
    const { promptBuilder, toolCtx, lang, dreamMemoryPath } = this.deps;
    const fullSystem = await promptBuilder.build(state.userMessage, dreamMemoryPath);
    const postHistoryReminder = promptBuilder.buildPostHistoryReminder();
    const conversationPlan = buildConversationPlan({ userMessage: state.userMessage, history: state.chatHistory });

    return {
      ...state,
      messages: [
        { role: "system", content: fullSystem },
        ...state.chatHistory,
        { role: "user", content: state.userMessage },
        { role: "system", content: conversationPlan },
        { role: "system", content: postHistoryReminder },
      ],
      tools: createTools(toolCtx, lang),
    };
  }

  private async runLlmToolLoop(state: AgentTurnState): Promise<AgentTurnState> {
    const { provider } = this.deps;
    const messages = [...state.messages];
    let totalText = "";
    let toolCallsMade = 0;
    let iterations = 0;

    for (; iterations < MAX_TOOL_ITERATIONS; iterations++) {
      const conversationTools = this.conversationTools(state.tools);
      log.debug({ iter: iterations, maxIters: MAX_TOOL_ITERATIONS, messageCount: messages.length, toolCount: conversationTools.size }, 'llm node iteration start');

      const result = await provider.chat(messages, toolsToOpenAI(conversationTools), {
        temperature: 0.7,
        maxTokens: 4096,
        stop: ["\nUser:", "\nLearner:", "\n<|im_start|>", "\n<|im_end|>"],
      });

      log.debug({ iter: iterations, toolCalls: result.toolCalls.length, contentLength: result.content?.length ?? 0 }, 'llm node iteration result');

      if (result.toolCalls.length === 0) {
        totalText = result.content ?? "";
        break;
      }

      messages.push({
        role: "assistant",
        content: result.content ?? "",
        tool_calls: result.toolCalls,
      });

      const toolResults = await Promise.all(result.toolCalls.map((tc) => callTool(tc, state.tools)));
      messages.push(...toolResults);
      toolCallsMade += toolResults.filter((tr) => tr.toolCalled).length;
    }

    return { ...state, messages, totalText, toolCallsMade, iterations: iterations + 1 };
  }

  private async schedulePostTurnEvaluation(state: AgentTurnState): Promise<AgentTurnState> {
    const { provider, toolCtx, lang } = this.deps;
    if (!state.totalText.trim() || state.options.postTurn === false || state.options.sourceType === "cron" || state.options.sourceType === "proactive" || state.options.sourceType === "system") {
      return state;
    }

    const evaluatorProvider = this.deps.evaluatorProvider ?? provider;
    const postTurn = new PostTurnProcessor({
      provider: evaluatorProvider,
      errors: toolCtx.errors,
      competency: toolCtx.competency,
      session: toolCtx.session,
      interests: toolCtx.interests,
      learning: toolCtx.learning,
      lang,
    });
    postTurn.process({ userMessage: state.userMessage, assistantText: state.totalText, chatHistory: state.chatHistory }).catch((err) =>
      log.warn({ err }, "post-turn evaluation failed")
    );
    return state;
  }
}
