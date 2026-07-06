import type { ChatMessage, ChatOptions, ChatResult, LLMProvider, LlmUsageContext, LlmUsageInput } from "./interfaces.js";

export class CostTrackingProvider implements LLMProvider {
  constructor(
    private inner: LLMProvider,
    private record: (input: LlmUsageInput) => void | Promise<void>,
    private context: LlmUsageContext,
  ) {}

  async chat(messages: ChatMessage[], tools?: object[], opts?: ChatOptions): Promise<ChatResult> {
    const start = Date.now();
    const result = await this.inner.chat(messages, tools, opts);
    if (result.usage) {
      await this.record({
        ...this.context,
        ...opts?.costContext,
        ...result.usage,
        latencyMs: Date.now() - start,
      });
    }
    return result;
  }

  async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
    const result = await this.chat(promptToMessages(systemPrompt, userPrompt), undefined, {
      ...opts,
      temperature: opts?.temperature ?? 0.7,
      maxTokens: opts?.maxTokens ?? 1024,
    });
    return result.content ?? "";
  }

  async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
    const jsonOpts = { ...opts, temperature: opts?.temperature ?? 0, structured: true };
    let text = await this.complete(systemPrompt, userPrompt, jsonOpts);
    try {
      return parseJsonResponse<T>(text);
    } catch (firstErr) {
      text = await this.complete(systemPrompt, [
        userPrompt,
        "",
        "Previous response was not valid JSON. Return one complete JSON object only; no prose or markdown.",
      ].join("\n"), jsonOpts);
      try {
        return parseJsonResponse<T>(text);
      } catch {
        throw firstErr;
      }
    }
  }
}

function promptToMessages(systemPrompt: string | null, userPrompt: string): ChatMessage[] {
  return [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    { role: "user" as const, content: userPrompt },
  ];
}

function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed) throw new SyntaxError("empty_json_response");
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? extractJsonObject(trimmed) ?? trimmed;
  return JSON.parse(candidate) as T;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}
