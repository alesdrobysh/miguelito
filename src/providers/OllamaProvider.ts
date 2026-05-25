import type { LLMProvider, ChatOptions, ChatResult, ChatMessage } from "./interfaces.js";
import { chatCompletion, promptToMessages } from "./openAiCompatibleClient.js";

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL = "llama3.2";

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string | undefined;

  constructor(config?: OllamaConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.model = config?.model ?? DEFAULT_MODEL;
    this.apiKey = config?.apiKey;
  }

  async chat(messages: ChatMessage[], tools?: object[], opts?: ChatOptions): Promise<ChatResult> {
    return chatCompletion(
      {
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        model: this.model,
        providerName: "ollama",
        timeoutMs: 120_000,
      },
      messages,
      tools,
      opts,
    );
  }

  async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
    const result = await this.chat(promptToMessages(systemPrompt, userPrompt), undefined, opts);
    return result.content ?? "";
  }

  async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
    const raw = await this.complete(systemPrompt, userPrompt, { ...opts, structured: true });
    return JSON.parse(raw) as T;
  }
}
