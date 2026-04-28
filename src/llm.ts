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
  tools?: ToolDefinition[],
  temperature: number = 0.7,
  maxTokens: number = 1024,
): Promise<ChatResult> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? BUDGET_MODEL;

  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.name) msg.name = m.name;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    }),
    temperature,
    max_tokens: maxTokens,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const truncated = text.slice(0, 300);
    throw new Error(`openrouter_api_error_${resp.status}: ${truncated}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  if (!choice) throw new Error("no_choices_in_response");

  const message = choice.message as Record<string, unknown> | undefined;
  if (!message) throw new Error("no_message_in_choice");

  const content = (message.content as string) ?? "";
  const rawToolCalls = message.tool_calls as ToolCall[] | undefined;

  return {
    content,
    toolCalls: rawToolCalls ?? [],
  };
}

export async function llmComplete(
  apiKey: string,
  systemPrompt: string | null,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  const result = await llmChat(
    { apiKey },
    messages,
    undefined,
    temperature,
    maxTokens,
  );

  return result.content ?? "";
}

export async function llmCompleteJson<T>(
  apiKey: string,
  systemPrompt: string | null,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<T> {
  const raw = await llmComplete(apiKey, systemPrompt, userPrompt, temperature, maxTokens);
  const clean = raw
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(clean) as T;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}