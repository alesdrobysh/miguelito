import type { ChatMessage } from "../llm.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { SessionRepository } from "../repositories/interfaces.js";
import type { ToolContext } from "../tools/index.js";
import { createTools, toolsToOpenAI } from "../tools/index.js";
import { callTool } from "./ToolExecutor.js";
import type { PromptBuilder } from "./PromptBuilder.js";

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
const CONV_STATE_PARSE_RE = /\[CONV_STATE:\s*(?:mode=)?(REACT|DIG|OFFER|TEACH|PLAY)(?:[,\s]+(?:topic=)?([^,\]\n]+?))?(?:[,\s]+(?:mood=)?([^\]\n]+?))?\s*\]/;
const CONV_STATE_STRIP_RE = /\s*\[CONV_STATE:[^\]]*\]/g;

export class AgentRunner {
  constructor(private deps: AgentDeps) {}

  async run(userMessage: string, chatHistory: ChatMessage[]): Promise<AgentResult> {
    const { provider, session, promptBuilder, toolCtx, soulPath, dreamMemoryPath } = this.deps;

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

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await provider.chat(messages, openaiTools, { temperature: 0.7, maxTokens: 4096 });

      if (result.content) {
        totalText += result.content;
      }

      if (result.toolCalls.length === 0) {
        const match = totalText.match(CONV_STATE_PARSE_RE);
        if (match) {
          const mode = match[1];
          const topic = match[2]?.trim() || undefined;
          const mood = match[3]?.trim() || undefined;
          await session.updateConversationState(mode, topic, mood);
        }
        totalText = totalText.replace(CONV_STATE_STRIP_RE, "").trim();
        break;
      }

      messages.push({
        role: "assistant",
        content: (result.content ?? "").replace(CONV_STATE_STRIP_RE, "").trim(),
        tool_calls: result.toolCalls,
      });

      const toolCalls = result.toolCalls.map((tc) => callTool(tc, tools));
      const toolResults = await Promise.all(toolCalls);
      messages.push(...toolResults);
      toolCallsMade += toolResults.filter((tr) => tr.toolCalled).length;
    }

    return { text: totalText, toolCallsMade };
  }
}
