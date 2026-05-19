import type { LLMProvider, ChatOptions, ChatResult, ChatMessage, ToolCall } from "./interfaces.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'ollama' });

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

  async chat(
    messages: ChatMessage[],
    tools?: object[],
    opts?: ChatOptions,
  ): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        return msg;
      }),
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 1024,
    };

    if (opts?.stop && opts.stop.length > 0) {
      body.stop = opts.stop;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    if (opts?.structured) {
      body.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const start = Date.now();
    log.debug({ model: this.model, messageCount: messages.length }, 'http request');

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const truncated = text.slice(0, 300);
      log.error({ status: resp.status, body: truncated }, 'http error');
      throw new Error(`ollama_api_error_${resp.status}: ${truncated}`);
    }

    const latencyMs = Date.now() - start;
    log.debug({ status: resp.status, latencyMs }, 'http response');

    const data = (await resp.json()) as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice) throw new Error("no_choices_in_response");

    const message = choice.message as Record<string, unknown> | undefined;
    if (!message) throw new Error("no_message_in_choice");

    const content = (message.content as string | null) ?? null;
    const rawToolCalls = message.tool_calls as ToolCall[] | undefined;

    return {
      content,
      toolCalls: rawToolCalls ?? [],
    };
  }

  async complete(
    systemPrompt: string | null,
    userPrompt: string,
    opts?: ChatOptions,
  ): Promise<string> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userPrompt });

    const result = await this.chat(messages, undefined, opts);
    return result.content ?? "";
  }

  async completeJson<T>(
    systemPrompt: string | null,
    userPrompt: string,
    opts?: ChatOptions,
  ): Promise<T> {
    const raw = await this.complete(systemPrompt, userPrompt, {
      ...opts,
      structured: true,
    });
    return JSON.parse(raw) as T;
  }
}
