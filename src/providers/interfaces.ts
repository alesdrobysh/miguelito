import type { ChatMessage, ToolCall } from "../llm.js";

export type { ChatMessage, ToolCall };

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  structured?: boolean;
  stop?: string[];
  timeoutMs?: number;
  costContext?: Partial<LlmUsageContext>;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: ChatUsage;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface LlmUsageContext {
  userId: number;
  language: string;
  provider: string;
  model: string;
  purpose: "chat" | "evaluator" | "dream" | "tool" | "system";
}

export interface LlmUsageInput extends LlmUsageContext, ChatUsage {
  latencyMs?: number;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools?: object[], opts?: ChatOptions): Promise<ChatResult>;
  complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string>;
  completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T>;
}
