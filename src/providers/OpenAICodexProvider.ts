import fs from "fs";
import os from "os";
import path from "path";
import type { LLMProvider, ChatOptions, ChatResult, ChatMessage, ToolCall } from "./interfaces.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: "openai-codex" });

export interface OpenAICodexConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  authFile?: string;
}

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.1-codex-mini";

type TokenSource = "api_key" | "hermes_auth" | "codex_auth";

interface ResolvedToken {
  token: string;
  source: TokenSource;
}

function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tokenFromHermesAuth(data: unknown): string {
  if (!isObject(data)) return "";

  const providers = data.providers;
  if (isObject(providers)) {
    const state = providers["openai-codex"];
    if (isObject(state)) {
      const tokens = state.tokens;
      if (isObject(tokens)) {
        const access = stringValue(tokens.access_token) || stringValue(tokens.accessToken);
        if (access) return access;
      }
    }
  }

  const pool = data.credential_pool;
  if (isObject(pool)) {
    const entries = pool["openai-codex"];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (!isObject(entry)) continue;
        const access = stringValue(entry.access_token) || stringValue(entry.accessToken);
        if (access) return access;
      }
    }
  }

  return "";
}

function tokenFromCodexAuth(data: unknown): string {
  if (!isObject(data)) return "";
  const tokens = data.tokens;
  if (isObject(tokens)) {
    const access = stringValue(tokens.access_token) || stringValue(tokens.accessToken);
    if (access) return access;
  }
  const oauth = data.oauth;
  if (isObject(oauth)) {
    const access = stringValue(oauth.access_token) || stringValue(oauth.accessToken);
    if (access) return access;
  }
  return stringValue(data.access_token) || stringValue(data.accessToken);
}

function codexHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "codex_cli_rs/0.0.0 (Miguelito)",
    originator: "codex_cli_rs",
  };

  try {
    const [, payload] = accessToken.split(".");
    if (!payload) return headers;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = decoded["https://api.openai.com/auth"];
    if (isObject(auth)) {
      const accountId = stringValue(auth.chatgpt_account_id);
      if (accountId) headers["ChatGPT-Account-ID"] = accountId;
    }
  } catch {
    // Auth errors should come from the API, not from local JWT parsing.
  }

  return headers;
}

function responseContentText(item: unknown): string {
  if (!isObject(item)) return "";
  const content = item.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isObject(part)) return "";
      const type = stringValue(part.type);
      if (type !== "output_text" && type !== "text") return "";
      return stringValue(part.text);
    })
    .join("");
}

function convertTools(tools?: object[]): object[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const converted: object[] = [];
  for (const tool of tools) {
    if (!isObject(tool)) continue;
    const fn = tool.function;
    if (!isObject(fn)) continue;
    const name = stringValue(fn.name);
    if (!name) continue;
    converted.push({
      type: "function",
      name,
      description: stringValue(fn.description),
      parameters: isObject(fn.parameters) ? fn.parameters : { type: "object", properties: {} },
    });
  }
  return converted.length > 0 ? converted : undefined;
}

function deterministicCallId(name: string, args: string, index: number): string {
  return `call_${Buffer.from(`${name}:${args}:${index}`).toString("base64url").slice(0, 16)}`;
}

export class OpenAICodexProvider implements LLMProvider {
  private apiKey?: string;
  private baseUrl: string;
  private model: string;
  private authFile?: string;

  constructor(config: OpenAICodexConfig) {
    this.apiKey = config.apiKey?.trim() || undefined;
    this.authFile = config.authFile?.trim() || undefined;
    this.baseUrl = config.baseUrl ?? (this.apiKey ? DEFAULT_OPENAI_BASE_URL : DEFAULT_CODEX_BASE_URL);
    this.model = config.model ?? DEFAULT_MODEL;
  }

  private resolveToken(): ResolvedToken {
    if (this.apiKey) return { token: this.apiKey, source: "api_key" };

    const candidates = this.authFile
      ? [expandHome(this.authFile)]
      : [path.join(os.homedir(), ".hermes/auth.json"), path.join(os.homedir(), ".codex/auth.json")];

    for (const candidate of candidates) {
      const data = readJson(candidate);
      if (!data) continue;
      const hermesToken = tokenFromHermesAuth(data);
      const codexToken = tokenFromCodexAuth(data);
      const token = hermesToken || codexToken;
      if (token) return { token, source: hermesToken ? "hermes_auth" : "codex_auth" };
    }

    throw new Error(
      "openai_codex_auth_missing: run `hermes auth add openai-codex` or `codex login`, or set OPENAI_CODEX_API_KEY/OPENAI_API_KEY",
    );
  }

  private isCodexBackend(source: TokenSource): boolean {
    return source !== "api_key" || this.baseUrl.includes("chatgpt.com/backend-api/codex");
  }

  async chat(
    messages: ChatMessage[],
    tools?: object[],
    opts?: ChatOptions,
  ): Promise<ChatResult> {
    const token = this.resolveToken();
    if (this.isCodexBackend(token.source)) {
      return this.chatViaCodexResponses(token.token, messages, tools, opts);
    }
    return this.chatViaOpenAIChatCompletions(token.token, messages, tools, opts);
  }

  private async chatViaOpenAIChatCompletions(
    bearerToken: string,
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

    if (tools && tools.length > 0) body.tools = tools;
    if (opts?.structured) body.response_format = { type: "json_object" };
    if (opts?.stop && opts.stop.length > 0) body.stop = opts.stop;

    const data = await this.postJson(`${this.baseUrl}/chat/completions`, bearerToken, body, false);
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice) throw new Error("no_choices_in_response");
    const message = choice.message as Record<string, unknown> | undefined;
    if (!message) throw new Error("no_message_in_choice");
    return {
      content: (message.content as string | null) ?? null,
      toolCalls: (message.tool_calls as ToolCall[] | undefined) ?? [],
    };
  }

  private responsesInput(messages: ChatMessage[]): object[] {
    const items: object[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      if (msg.role === "tool") {
        if (!msg.tool_call_id) continue;
        items.push({ type: "function_call_output", call_id: msg.tool_call_id, output: msg.content ?? "" });
        continue;
      }

      if (msg.role === "assistant" && msg.tool_calls?.length) {
        if ((msg.content ?? "").trim()) {
          items.push({ role: "assistant", content: msg.content ?? "" });
        }
        msg.tool_calls.forEach((tc, index) => {
          const args = typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {});
          items.push({
            type: "function_call",
            call_id: tc.id || deterministicCallId(tc.function.name, args, index),
            name: tc.function.name,
            arguments: args || "{}",
          });
        });
        continue;
      }

      items.push({ role: msg.role, content: msg.content ?? "" });
    }
    return items.length > 0 ? items : [{ role: "user", content: "" }];
  }

  private async chatViaCodexResponses(
    accessToken: string,
    messages: ChatMessage[],
    tools?: object[],
    opts?: ChatOptions,
  ): Promise<ChatResult> {
    const systemMessages = messages.filter((m) => m.role === "system").map((m) => m.content).filter(Boolean);
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: systemMessages.join("\n\n") || "You are a helpful assistant.",
      input: this.responsesInput(messages),
      store: false,
    };

    const convertedTools = convertTools(tools);
    if (convertedTools) {
      body.tools = convertedTools;
      body.tool_choice = "auto";
      body.parallel_tool_calls = true;
    }
    if (opts?.structured) {
      body.text = { format: { type: "json_object" } };
    }
    // The Codex backend rejects temperature/max_output_tokens/stop in some model combinations.
    // Let the model defaults apply for OAuth-backed Codex sessions.

    const data = await this.postJson(`${this.baseUrl}/responses`, accessToken, body, true);
    const output = Array.isArray(data.output) ? data.output : [];
    if (output.length === 0 && typeof data.output_text !== "string") throw new Error("no_output_in_response");

    const content = output.map(responseContentText).join("").trim() || stringValue(data.output_text) || null;
    const toolCalls: ToolCall[] = [];
    for (const item of output) {
      if (!isObject(item) || item.type !== "function_call") continue;
      const name = stringValue(item.name);
      if (!name) continue;
      const args = stringValue(item.arguments) || "{}";
      const callId = stringValue(item.call_id) || deterministicCallId(name, args, toolCalls.length);
      toolCalls.push({
        id: callId,
        type: "function",
        function: { name, arguments: args },
      });
    }

    return { content, toolCalls };
  }

  private async postJson(
    url: string,
    bearerToken: string,
    body: Record<string, unknown>,
    codexBackend: boolean,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    log.debug({ model: this.model, url: url.replace(/\/[^/]*$/, "/…") }, "http request");

    const resp = await fetch(url, {
      method: "POST",
      headers: codexBackend
        ? codexHeaders(bearerToken)
        : { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const truncated = text.slice(0, 300);
      log.error({ status: resp.status, body: truncated }, "http error");
      throw new Error(`openai_codex_api_error_${resp.status}: ${truncated}`);
    }

    log.debug({ status: resp.status, latencyMs: Date.now() - start }, "http response");
    return (await resp.json()) as Record<string, unknown>;
  }

  async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });
    const result = await this.chat(messages, undefined, opts);
    return result.content ?? "";
  }

  async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
    const raw = await this.complete(systemPrompt, userPrompt, {
      ...opts,
      temperature: opts?.temperature ?? 0,
      structured: true,
    });
    return JSON.parse(raw) as T;
  }
}
