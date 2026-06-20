import { Agent, OpenAIProvider, Runner, tool } from "@openai/agents";
import type { ChatMessage } from "../llm.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { ToolContext, ToolDefinition } from "../tools/index.js";
import { createTools } from "../tools/index.js";
import type { PromptBuilder } from "./PromptBuilder.js";
import { PostTurnProcessor } from "./PostTurnProcessor.js";
import { buildConversationPlan } from "./ConversationPlanner.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: "openai-agents" });

export interface OpenAIAgentsRunnerDeps {
  provider: LLMProvider;
  evaluatorProvider?: LLMProvider;
  promptBuilder: PromptBuilder;
  toolCtx: ToolContext;
  lang: LanguageConfig;
  apiKey: string;
  baseUrl: string;
  model: string;
  dreamMemoryPath?: string;
}

export interface OpenAIAgentsRunOptions {
  postTurn?: boolean;
  sourceType?: "user_chat" | "cron" | "proactive" | "system";
}

export interface OpenAIAgentsResult {
  text: string;
  toolCallsMade: number;
}

const INTERNAL_ONLY_TOOLS = new Set([
  "miguelito_turn_annotate",
  "miguelito_error_log",
  "miguelito_progress_summary",
  "miguelito_interest_add",
]);

function summarizeHistory(history: ChatMessage[]): string {
  if (!history.length) return "(none)";
  return history.map((message) => `${message.role}: ${message.content}`).join("\n");
}

function toStringArgs(args: unknown): Record<string, string> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  ]));
}

function toAgentsTool(definition: ToolDefinition, onToolCall: (name: string) => void) {
  return tool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters as never,
    strict: false,
    execute: async (args: unknown) => {
      onToolCall(definition.name);
      const result = await definition.execute(toStringArgs(args));
      return JSON.stringify(result);
    },
  });
}

export class OpenAIAgentsRunner {
  constructor(private deps: OpenAIAgentsRunnerDeps) {}

  async run(userMessage: string, chatHistory: ChatMessage[], options: OpenAIAgentsRunOptions = {}): Promise<OpenAIAgentsResult> {
    const traceId = `openai-agents-turn-${Date.now()}`;
    const fullSystem = await this.deps.promptBuilder.build(userMessage, this.deps.dreamMemoryPath);
    const conversationPlan = buildConversationPlan({ userMessage, history: chatHistory });
    const postHistoryReminder = this.deps.promptBuilder.buildPostHistoryReminder();
    const nativeTools = createTools(this.deps.toolCtx, this.deps.lang);
    let toolCallsMade = 0;
    const tools = Array.from(nativeTools.values())
      .filter((candidate) => !INTERNAL_ONLY_TOOLS.has(candidate.name))
      .map((candidate) => toAgentsTool(candidate, (name) => {
        toolCallsMade++;
        log.debug({ traceId, name }, "tool dispatched through Agents SDK");
      }));

    const agent = new Agent({
      name: "Miguelito Tutor",
      model: this.deps.model,
      instructions: [fullSystem, conversationPlan, postHistoryReminder].join("\n\n"),
      tools,
      modelSettings: {
        temperature: 0.7,
        maxTokens: 4096,
      },
    });
    const runner = new Runner({
      modelProvider: new OpenAIProvider({
        apiKey: this.deps.apiKey,
        baseURL: this.deps.baseUrl,
        useResponses: false,
      }),
      tracingDisabled: false,
    });

    log.info({ traceId, tools: tools.length, historyMessages: chatHistory.length }, "Agents SDK run start");
    const result = await runner.run(agent, [
      "Recent chat history:",
      summarizeHistory(chatHistory),
      "Latest learner message:",
      userMessage,
    ].join("\n\n"), { maxTurns: 10 });
    const text = String(result.finalOutput ?? "");
    log.info({ traceId, toolCallsMade, responseLength: text.length }, "Agents SDK run complete");

    this.schedulePostTurnEvaluation(userMessage, text, chatHistory, options);
    return { text, toolCallsMade };
  }

  private schedulePostTurnEvaluation(userMessage: string, assistantText: string, chatHistory: ChatMessage[], options: OpenAIAgentsRunOptions): void {
    if (!assistantText.trim() || options.postTurn === false || options.sourceType === "cron" || options.sourceType === "proactive" || options.sourceType === "system") {
      return;
    }

    const postTurn = new PostTurnProcessor({
      provider: this.deps.evaluatorProvider ?? this.deps.provider,
      errors: this.deps.toolCtx.errors,
      competency: this.deps.toolCtx.competency,
      session: this.deps.toolCtx.session,
      interests: this.deps.toolCtx.interests,
      learning: this.deps.toolCtx.learning,
      lang: this.deps.lang,
    });
    postTurn.process({ userMessage, assistantText, chatHistory }).catch((err) =>
      log.warn({ err }, "post-turn evaluation failed")
    );
  }
}
