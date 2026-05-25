import http from "http";
import { URL } from "url";
import type { RuntimeManager } from "../runtime.js";
import type { Transport } from "../transport/Transport.js";
import { WebApi } from "./api.js";
import { staticAsset, staticIndex } from "./static.js";
import type { ApiResponse } from "./types.js";
import { json } from "./types.js";

export type { ApiResponse };

interface WebServerOptions {
  chatId?: number;
  userId?: string;
  mirrorTransports?: Record<string, Pick<Transport, "sendMessage">>;
}

const WEB_CHAT_ID = 0;
const WEB_USER_ID = "web-user";

export class WebServer {
  private server: http.Server | null = null;
  private api: WebApi;

  constructor(private manager: RuntimeManager, options: WebServerOptions = {}) {
    this.api = new WebApi(manager, {
      chatId: options.chatId ?? WEB_CHAT_ID,
      userId: options.userId ?? WEB_USER_ID,
      mirrorTransports: options.mirrorTransports ?? {},
    });
  }

  async handleApi(method: string, rawUrl: string, body?: unknown): Promise<ApiResponse> {
    return this.api.handle(method, rawUrl, body);
  }

  start(host: string, port: number): void {
    this.server = http.createServer(async (req, res) => {
      try {
        const response = await this.routeRequest(req);
        res.writeHead(response.status, { "Content-Type": response.contentType });
        res.end(response.body);
      } catch (err: any) {
        const response = json(500, { error: err?.message ?? String(err) });
        res.writeHead(response.status, { "Content-Type": response.contentType });
        res.end(response.body);
      }
    });
    this.server.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.log(`Miguelito web UI listening on http://${host}:${port}`);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async routeRequest(req: http.IncomingMessage): Promise<ApiResponse> {
    const method = req.method ?? "GET";
    const reqUrl = req.url ?? "/";
    const url = new URL(reqUrl, "http://localhost");

    if (url.pathname.startsWith("/api/")) {
      const body = method === "POST" ? await readJson(req) : undefined;
      return this.handleApi(method, reqUrl, body);
    }

    if (url.pathname.startsWith("/assets/")) return staticAsset(url.pathname);
    if (url.pathname === "/" || url.pathname === "/chat" || url.pathname === "/settings") return staticIndex();
    return staticIndex();
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}
