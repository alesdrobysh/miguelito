import type { ChatMessage as MiguelitoChatMessage, ToolCall as MiguelitoToolCall } from "../llm.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { ToolContext, ToolDefinition } from "../tools/index.js";
import { createTools } from "../tools/index.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import { logger } from "../infrastructure/logger.js";
import { PostTurnProcessor } from "./PostTurnProcessor.js";
import { buildConversationPlan } from "./ConversationPlanner.js";
import type { AgentDeps, AgentResult, AgentRunOptions } from "./AgentRunner.js";
import { LLMAgent, FunctionTool } from "llamaindex";
import type {
  BaseToolWithCall,
  ChatMessage as LlamaChatMessage,
  ChatResponse,
  ChatResponseChunk,
  CompletionResponse,
  LLM,
  LLMChatParamsNonStreaming,
  LLMChatParamsStreaming,
  LLMCompletionParamsNonStreaming,
  LLMCompletionParamsStreaming,
  LLMMetadata,
  MessageContent,
  ToolCallLLMMessageOptions,
} from "llamaindex";

const log = logger.child({ ctx: "agent", runtime: "llamaindex" });

const MAX_TOOL_ITERATIONS = 10;

function contentToString(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      return `[${part.type}]`;
    })
    .join("\n");
}

function llamaMessagesToMiguelito(messages: LlamaChatMessage<ToolCallLLMMessageOptions>[]): MiguelitoChatMessage[] {
  const out: MiguelitoChatMessage[] = [];

  for (const message of messages) {
    const options = message.options as ToolCallLLMMessageOptions | undefined;
    if (options && "toolResult" in options) {
      out.push({
        role: "tool",
        tool_call_id: options.toolResult.id,
        name: options.toolResult.id,
        content: options.toolResult.result,
      });
      continue;
    }

    if (message.role === "memory" || message.role === "developer") continue;
    const role = message.role as MiguelitoChatMessage["role"];
    const mapped: MiguelitoChatMessage = { role, content: contentToString(message.content) };

    if (options && "toolCall" in options) {
      mapped.tool_calls = options.toolCall.map((tc): MiguelitoToolCall => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
        },
      }));
    }

    out.push(mapped);
  }

  return out;
}

function llamaToolsToOpenAI(tools: BaseToolWithCall[] | undefined): object[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.metadata.name,
      description: tool.metadata.description,
      parameters: tool.metadata.parameters ?? { type: "object", properties: {}, additionalProperties: true },
    },
  }));
}

function miguelitoToolCallsToLlama(toolCalls: MiguelitoToolCall[]) {
  return toolCalls.map((tc) => {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function.arguments || "{}");
    } catch {
      input = { raw: tc.function.arguments };
    }
    return { id: tc.id, name: tc.function.name, input };
  });
}

class MiguelitoLlamaLLM implements LLM<object, ToolCallLLMMessageOptions> {
  metadata: LLMMetadata = {
    model: process.env.CHAT_MODEL ?? "miguelito-provider",
    temperature: 0.7,
    topP: 1,
    maxTokens: 4096,
    contextWindow: 128_000,
    tokenizer: undefined,
    structuredOutput: false,
  };

  constructor(private provider: LLMProvider) {}

  async chat(params: LLMChatParamsStreaming<object, ToolCallLLMMessageOptions>): Promise<AsyncIterable<ChatResponseChunk<ToolCallLLMMessageOptions>>>;
  async chat(params: LLMChatParamsNonStreaming<object, ToolCallLLMMessageOptions>): Promise<ChatResponse<ToolCallLLMMessageOptions>>;
  async chat(
    params: LLMChatParamsStreaming<object, ToolCallLLMMessageOptions> | LLMChatParamsNonStreaming<object, ToolCallLLMMessageOptions>,
  ): Promise<ChatResponse<ToolCallLLMMessageOptions> | AsyncIterable<ChatResponseChunk<ToolCallLLMMessageOptions>>> {
    if (params.stream) {
      throw new Error("MiguelitoLlamaLLM does not implement streaming in this spike");
    }

    const result = await this.provider.chat(
      llamaMessagesToMiguelito(params.messages),
      llamaToolsToOpenAI(params.tools as BaseToolWithCall[] | undefined),
      {
        temperature: 0.7,
        maxTokens: 4096,
        stop: ["\nUser:", "\nLearner:", "\n<|im_start|>", "\n<|im_end|>"],
      },
    );

    const options: ToolCallLLMMessageOptions = result.toolCalls.length
      ? { toolCall: miguelitoToolCallsToLlama(result.toolCalls) }
      : {};

    return {
      message: {
        role: "assistant",
        content: result.content ?? "",
        options,
      },
      raw: result as unknown as object,
    };
  }

  async complete(params: LLMCompletionParamsStreaming): Promise<AsyncIterable<CompletionResponse>>;
  async complete(params: LLMCompletionParamsNonStreaming): Promise<CompletionResponse>;
  async complete(
    params: LLMCompletionParamsStreaming | LLMCompletionParamsNonStreaming,
  ): Promise<CompletionResponse | AsyncIterable<CompletionResponse>> {
    if (params.stream) {
      throw new Error("MiguelitoLlamaLLM does not implement streaming completion in this spike");
    }
    const text = await this.provider.complete(null, contentToString(params.prompt), { temperature: 0.7, maxTokens: 4096 });
    return { text, raw: null };
  }
}

export class LlamaIndexRunner {
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

  private toLlamaTool(tool: ToolDefinition): BaseToolWithCall {
    return FunctionTool.from(
      async (input: Record<string, unknown>) => {
        log.debug({ tool: tool.name }, "llamaindex tool call start");
        const result = await tool.execute(input as Record<string, string>);
        log.debug({ tool: tool.name }, "llamaindex tool call complete");
        return result as never;
      },
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as never,
      },
    ) as BaseToolWithCall;
  }

  async run(userMessage: string, chatHistory: MiguelitoChatMessage[], options: AgentRunOptions = {}): Promise<AgentResult> {
    const { provider, promptBuilder, toolCtx, lang, dreamMemoryPath } = this.deps;
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const fullSystem = await promptBuilder.build(userMessage, dreamMemoryPath);
    const conversationPlan = buildConversationPlan({ userMessage, history: chatHistory });
    const postHistoryReminder = promptBuilder.buildPostHistoryReminder();
    const systemPrompt = [fullSystem, conversationPlan, postHistoryReminder].join("\n\n");

    const tools = createTools(toolCtx, lang);
    const llamaTools = Array.from(this.conversationTools(tools).values()).map((tool) => this.toLlamaTool(tool));
    const llamaHistory: LlamaChatMessage[] = chatHistory
      .filter((message): message is MiguelitoChatMessage & { role: "system" | "user" | "assistant" } => message.role !== "tool")
      .map((message) => ({ role: message.role, content: message.content }));

    log.info({ traceId, toolCount: llamaTools.length, historyMessages: llamaHistory.length }, "llamaindex run start");

    const llm = new MiguelitoLlamaLLM(provider);
    const agent = new LLMAgent({
      llm,
      tools: llamaTools,
      chatHistory: llamaHistory,
      systemPrompt,
      verbose: true,
      additionalChatOptions: {},
    });

    const response = await agent.chat({ message: userMessage, stream: false });
    const totalText = response.toString();
    const rawToolOutputs = ((response as unknown as { raw?: { toolOutputs?: unknown[] } }).raw?.toolOutputs ?? []) as unknown[];
    const toolCallsMade = rawToolOutputs.length;

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
        log.warn({ err, traceId }, "post-turn evaluation failed"),
      );
    }

    log.info({ traceId, toolCallsMade, responseLength: totalText.length, maxToolIterations: MAX_TOOL_ITERATIONS }, "llamaindex run complete");

    return { text: totalText, toolCallsMade };
  }
}
