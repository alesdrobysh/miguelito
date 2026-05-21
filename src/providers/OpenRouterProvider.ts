import { llmChat, type LLMConfig } from "../llm.js";
import type { LLMProvider, ChatOptions, ChatResult, ChatMessage } from "./interfaces.js";

export class OpenRouterProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[], tools?: object[], opts?: ChatOptions): Promise<ChatResult> {
    return llmChat(this.config, messages, tools, opts?.temperature, opts?.maxTokens, opts?.structured, opts?.stop);
  }

  async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });
    const result = await llmChat(this.config, messages, undefined, opts?.temperature ?? 0.7, opts?.maxTokens ?? 1024, opts?.structured);
    return result.content ?? "";
  }

  async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
    const text = await this.complete(systemPrompt, userPrompt, { ...opts, temperature: opts?.temperature ?? 0, structured: true });
    return JSON.parse(text) as T;
  }
}
