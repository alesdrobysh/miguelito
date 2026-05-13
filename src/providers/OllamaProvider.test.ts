import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OllamaProvider } from "./OllamaProvider.js";

function mockFetch(data: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve("error text"),
  });
}

describe("OllamaProvider", () => {
  let provider: OllamaProvider;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("does not require arguments", () => {
      provider = new OllamaProvider();
      expect(provider).toBeInstanceOf(OllamaProvider);
    });

    it("accepts custom baseUrl and model", () => {
      provider = new OllamaProvider({ baseUrl: "http://custom:8080/v1", model: "mistral" });
      expect(provider).toBeInstanceOf(OllamaProvider);
    });
  });

  describe("chat", () => {
    beforeEach(() => {
      provider = new OllamaProvider();
    });

    it("sends POST to /chat/completions with correct defaults", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "Hello!" } }] });
      vi.stubGlobal("fetch", fetch);

      const result = await provider.chat([{ role: "user", content: "hi" }]);

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining('"model":"llama3.2"'),
        }),
      );
      expect(result.content).toBe("Hello!");
      expect(result.toolCalls).toEqual([]);
    });

    it("does not send Authorization header", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "" } }] });
      vi.stubGlobal("fetch", fetch);

      await provider.chat([{ role: "user", content: "hi" }]);

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it("uses custom baseUrl when configured", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] });
      vi.stubGlobal("fetch", fetch);
      provider = new OllamaProvider({ baseUrl: "http://192.168.1.5:11434/v1" });

      await provider.chat([{ role: "user", content: "hi" }]);

      expect(fetch).toHaveBeenCalledWith(
        "http://192.168.1.5:11434/v1/chat/completions",
        expect.anything(),
      );
    });

    it("uses custom model when configured", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] });
      vi.stubGlobal("fetch", fetch);
      provider = new OllamaProvider({ model: "llama3.1:8b" });

      await provider.chat([{ role: "user", content: "hi" }]);

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.model).toBe("llama3.1:8b");
    });

    it("passes tools in request body", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] });
      vi.stubGlobal("fetch", fetch);

      const tools = [{ type: "function", function: { name: "test" } }];
      await provider.chat([{ role: "user", content: "hi" }], tools);

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.tools).toEqual(tools);
    });

    it("sets response_format for structured mode", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: '{"k":"v"}' } }] });
      vi.stubGlobal("fetch", fetch);

      await provider.chat([{ role: "user", content: "hi" }], undefined, { structured: true });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("passes temperature and maxTokens from opts", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "ok" } }] });
      vi.stubGlobal("fetch", fetch);

      await provider.chat(
        [{ role: "user", content: "hi" }],
        undefined,
        { temperature: 0.3, maxTokens: 2048 },
      );

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(2048);
    });

    it("returns tool calls when present", async () => {
      const fetch = mockFetch({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Paris"}' },
            }],
          },
        }],
      });
      vi.stubGlobal("fetch", fetch);

      const result = await provider.chat([{ role: "user", content: "weather?" }]);

      expect(result.content).toBeNull();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].function.name).toBe("get_weather");
    });

    it("throws on non-ok response", async () => {
      const fetch = mockFetch({ error: "not found" }, false);
      vi.stubGlobal("fetch", fetch);

      await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow();
    });
  });

  describe("complete", () => {
    beforeEach(() => {
      provider = new OllamaProvider();
    });

    it("sends system + user messages and returns content", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "Sure, I can help!" } }] });
      vi.stubGlobal("fetch", fetch);

      const result = await provider.complete("You are helpful", "Help me");

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Help me" },
      ]);
      expect(result).toBe("Sure, I can help!");
    });

    it("works without system prompt", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: "reply" } }] });
      vi.stubGlobal("fetch", fetch);

      const result = await provider.complete(null, "Hello");

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(result).toBe("reply");
    });
  });

  describe("completeJson", () => {
    beforeEach(() => {
      provider = new OllamaProvider();
    });

    it("returns parsed JSON", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: '{"name":"Alice"}' } }] });
      vi.stubGlobal("fetch", fetch);

      const result = await provider.completeJson<{ name: string }>(null, "Return JSON");

      expect(result).toEqual({ name: "Alice" });
    });

    it("uses structured mode (response_format)", async () => {
      const fetch = mockFetch({ choices: [{ message: { content: '{"x":1}' } }] });
      vi.stubGlobal("fetch", fetch);

      await provider.completeJson(null, "Return JSON");

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: "json_object" });
    });
  });
});
