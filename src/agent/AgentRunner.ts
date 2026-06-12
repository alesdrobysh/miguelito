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
    const { provider, promptBuilder, toolCtx, lang, dreamMemoryPath } = this.deps;

    const fullSystem = await promptBuilder.build(userMessage, dreamMemoryPath);
    const postHistoryReminder = promptBuilder.buildPostHistoryReminder();
    const conversationPlan = buildConversationPlan({ userMessage, history: chatHistory });

    const messages: ChatMessage[] = [
      { role: "system", content: fullSystem },
      ...chatHistory,
      { role: "user", content: userMessage },
      { role: "system", content: conversationPlan },
      { role: "system", content: postHistoryReminder },
    ];

    const tools = createTools(toolCtx, lang);
    const openaiTools = toolsToOpenAI(tools);

    let totalText = "";
    let toolCallsMade = 0;
    let i = 0;

    for (; i < MAX_TOOL_ITERATIONS; i++) {
      log.debug({ iter: i, maxIters: MAX_TOOL_ITERATIONS, toolCount: openaiTools.length }, 'llm call start');

      const result = await provider.chat(messages, toolsToOpenAI(this.conversationTools(tools)), {
        temperature: 0.7,
        maxTokens: 4096,
        stop: ["\nUser:", "\nLearner:", "\n<|im_start|>", "\n<|im_end|>"],
      });

      if (result.toolCalls.length === 0) {
        totalText = result.content ?? "";
        break;
      }

      messages.push({
        role: "assistant",
        content: result.content ?? "",
        tool_calls: result.toolCalls,
      });

      const toolCalls = result.toolCalls.map((tc) => callTool(tc, tools));
      const toolResults = await Promise.all(toolCalls);
      messages.push(...toolResults);
      toolCallsMade += toolResults.filter((tr) => tr.toolCalled).length;
    }

    if (totalText.trim() && options.postTurn !== false && options.sourceType !== "cron" && options.sourceType !== "proactive" && options.sourceType !== "system") {
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
      postTurn.process({ userMessage, assistantText: totalText, chatHistory }).catch((err) =>
        log.warn({ err }, "post-turn evaluation failed")
      );
    }

    log.info({ totalIters: i + 1, toolCallsMade, responseLength: totalText.length }, 'run complete');

    return { text: totalText, toolCallsMade };
  }
}
