import { chatCompletion } from "./providers/openAiCompatibleClient.js";

const BUDGET_MODEL = "google/gemini-2.0-flash-lite";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export async function llmChat(
  config: LLMConfig,
  messages: ChatMessage[],
  tools?: object[],
  temperature: number = 0.7,
  maxTokens: number = 1024,
  structured: boolean = false,
  stop?: string[],
  timeoutMs?: number,
): Promise<ChatResult> {
  return chatCompletion(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      model: config.model ?? BUDGET_MODEL,
      providerName: "openrouter",
      timeoutMs: timeoutMs ?? 30_000,
    },
    messages,
    tools,
    { temperature, maxTokens, structured, stop, timeoutMs },
  );
}

export async function llmComplete(
  apiKey: string,
  systemPrompt: string | null,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  structured: boolean = false,
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });

  const result = await llmChat({ apiKey }, messages, undefined, temperature, maxTokens, structured);
  return result.content ?? "";
}

export async function llmCompleteJson<T>(
  apiKey: string,
  systemPrompt: string | null,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<T> {
  const raw = await llmComplete(apiKey, systemPrompt, userPrompt, temperature, maxTokens, true);
  return JSON.parse(raw) as T;
}
