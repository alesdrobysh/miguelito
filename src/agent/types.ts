import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { SessionRepository } from "../repositories/interfaces.js";
import type { ToolContext } from "../tools/index.js";
import type { PromptBuilder } from "./PromptBuilder.js";

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

export interface AgentRuntime {
  run(userMessage: string, chatHistory: import("../llm.js").ChatMessage[], options?: AgentRunOptions): Promise<AgentResult>;
}
