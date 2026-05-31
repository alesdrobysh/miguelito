import type { ChatMessage, ToolCall } from "../llm.js";

export type { ChatMessage, ToolCall };

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  structured?: boolean;
  stop?: string[];
  timeoutMs?: number;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools?: object[], opts?: ChatOptions): Promise<ChatResult>;
  complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string>;
  completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T>;
}
