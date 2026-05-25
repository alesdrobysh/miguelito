import { URL } from "url";
import type { RuntimeManager } from "../runtime.js";
import type { Transport } from "../transport/Transport.js";
import type { ApiResponse } from "./types.js";
import { json } from "./types.js";

export interface WebApiOptions {
  chatId: number;
  userId: string;
  mirrorTransports: Record<string, Pick<Transport, "sendMessage">>;
}

export class WebApi {
  constructor(private manager: RuntimeManager, private options: WebApiOptions) {}

  async handle(method: string, rawUrl: string, body?: unknown): Promise<ApiResponse> {
    const url = new URL(rawUrl, "http://localhost");
    if (method === "GET" && url.pathname === "/api/languages") {
      return json(200, { languages: this.manager.languages() });
    }

    if (url.pathname === "/api/chat" && method === "GET") {
      const language = url.searchParams.get("language") ?? "spanish";
      if (!this.manager.hasLanguage(language)) return json(404, { error: `Unknown language: ${language}` });
      const messages = await this.manager.getChatHistory(language, this.options.chatId);
      return json(200, { language, messages });
    }

    if (url.pathname === "/api/chat" && method === "POST") {
      const payload = body as { language?: string; text?: string } | undefined;
      const language = payload?.language ?? "spanish";
      const text = (payload?.text ?? "").trim();
      if (!this.manager.hasLanguage(language)) return json(404, { error: `Unknown language: ${language}` });
      if (!text) return json(400, { error: "text is required" });
      const reply = await this.manager.handleMessage(language, this.options.chatId, this.options.userId, text);
      const mirror = this.options.mirrorTransports[language];
      if (mirror) {
        await mirror.sendMessage(this.options.chatId, `🌐 Web: ${text}`);
        if (reply) await mirror.sendMessage(this.options.chatId, reply);
      }
      const messages = await this.manager.getChatHistory(language, this.options.chatId);
      return json(200, { language, reply, messages });
    }

    if (url.pathname === "/api/settings" && method === "GET") {
      return json(200, { languages: this.manager.languages(), chatId: this.options.chatId });
    }

    return json(404, { error: "Not found" });
  }
}
