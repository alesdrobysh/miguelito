import { logger } from "../infrastructure/logger.js";
import type { ChatMessage, ToolCall } from "../llm.js";
import type { ChatOptions, ChatResult, ChatUsage } from "./interfaces.js";

export interface OpenAiCompatibleConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  providerName: string;
  timeoutMs?: number;
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.tool_call_id) wire.tool_call_id = message.tool_call_id;
  if (message.name) wire.name = message.name;
  if (message.tool_calls) wire.tool_calls = message.tool_calls;
  return wire;
}

export async function chatCompletion(
  config: OpenAiCompatibleConfig,
  messages: ChatMessage[],
  tools?: object[],
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const log = logger.child({ ctx: config.providerName });
  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.map(toWireMessage),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
  };

  if (tools && tools.length > 0) body.tools = tools;
  if (opts.structured) body.response_format = { type: "json_object" };
  if (opts.stop && opts.stop.length > 0) body.stop = opts.stop;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const start = Date.now();
  log.debug({ model: config.model, messageCount: messages.length }, "http request");

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const truncated = text.slice(0, 300);
    log.error({ status: resp.status, body: truncated }, "http error");
    throw new Error(`${config.providerName}_api_error_${resp.status}: ${truncated}`);
  }

  const latencyMs = Date.now() - start;
  log.debug({ status: resp.status, latencyMs }, "http response");

  const data = (await resp.json()) as Record<string, unknown>;
  const usage = parseUsage(data.usage);
  if (usage) {
    log.info({ model: config.model, latencyMs, usage }, "llm cost tracking");
  }
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  if (!choice) throw new Error("no_choices_in_response");

  const message = choice.message as Record<string, unknown> | undefined;
  if (!message) throw new Error("no_message_in_choice");

  return {
    content: (message.content as string | null) ?? null,
    toolCalls: (message.tool_calls as ToolCall[] | undefined) ?? [],
    usage,
  };
}

function parseUsage(raw: unknown): ChatUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const parsed: ChatUsage = {
    promptTokens: numberOrUndefined(usage.prompt_tokens),
    completionTokens: numberOrUndefined(usage.completion_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
    costUsd: numberOrUndefined(usage.cost),
  };
  return Object.values(parsed).some((value) => value !== undefined) ? parsed : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function promptToMessages(systemPrompt: string | null, userPrompt: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });
  return messages;
}
