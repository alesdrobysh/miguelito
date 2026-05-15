import type { ChatMessage } from "../llm.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { SessionRepository } from "../repositories/interfaces.js";
import type { ToolContext } from "../tools/index.js";
import { createTools, toolsToOpenAI } from "../tools/index.js";
import { callTool } from "./ToolExecutor.js";
import type { PromptBuilder } from "./PromptBuilder.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'agent' });

export interface AgentDeps {
  provider: LLMProvider;
  session: SessionRepository;
  promptBuilder: PromptBuilder;
  toolCtx: ToolContext;
  soulPath: string;
  dreamMemoryPath?: string;
}

export interface AgentResult {
  text: string;
  toolCallsMade: number;
}

const MAX_TOOL_ITERATIONS = 10;

export class AgentRunner {
  constructor(private deps: AgentDeps) {}

  async run(userMessage: string, chatHistory: ChatMessage[]): Promise<AgentResult> {
    const { provider, promptBuilder, toolCtx, soulPath, dreamMemoryPath } = this.deps;

    const fullSystem = await promptBuilder.build(soulPath, dreamMemoryPath);

    const messages: ChatMessage[] = [
      { role: "system", content: fullSystem },
      ...chatHistory,
      { role: "user", content: userMessage },
    ];

    const tools = createTools(toolCtx);
    const openaiTools = toolsToOpenAI(tools);

    let totalText = "";
    let toolCallsMade = 0;
    let i = 0;

    for (; i < MAX_TOOL_ITERATIONS; i++) {
      log.debug({ iter: i, maxIters: MAX_TOOL_ITERATIONS, toolCount: openaiTools.length }, 'llm call start');

      const result = await provider.chat(messages, openaiTools, { temperature: 0.7, maxTokens: 4096 });

      if (result.content) {
        totalText += result.content;
      }

      if (result.toolCalls.length === 0) {
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

    log.info({ totalIters: i + 1, toolCallsMade, responseLength: totalText.length }, 'run complete');

    return { text: totalText, toolCallsMade };
  }
}
