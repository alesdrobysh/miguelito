import { llmChat, llmComplete, llmCompleteJson, type LLMConfig } from "../llm.js";
import type { LLMProvider, ChatOptions, ChatResult, ChatMessage } from "./interfaces.js";

export class OpenRouterProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[], tools?: object[], opts?: ChatOptions): Promise<ChatResult> {
    return llmChat(this.config, messages, tools, opts?.temperature, opts?.maxTokens, opts?.structured);
  }

  async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
    return llmComplete(this.config.apiKey, systemPrompt, userPrompt, opts?.temperature ?? 0.7, opts?.maxTokens ?? 1024, opts?.structured);
  }

  async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
    return llmCompleteJson<T>(this.config.apiKey, systemPrompt, userPrompt, opts?.temperature ?? 0.7, opts?.maxTokens ?? 1024);
  }
}
