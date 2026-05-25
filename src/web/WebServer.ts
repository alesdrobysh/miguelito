import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";
import type { RuntimeManager } from "../runtime.js";
import type { Transport } from "../transport/Transport.js";

export interface ApiResponse {
  status: number;
  contentType: string;
  body: string;
}

interface WebServerOptions {
  chatId?: number;
  userId?: string;
  mirrorTransports?: Record<string, Pick<Transport, "sendMessage">>;
}

const WEB_CHAT_ID = 0;
const WEB_USER_ID = "web-user";
const WEB_DIST_DIR = path.join(process.cwd(), "src", "web", "dist");

export class WebServer {
  private server: http.Server | null = null;
  private chatId: number;
  private userId: string;
  private mirrorTransports: Record<string, Pick<Transport, "sendMessage">>;

  constructor(private manager: RuntimeManager, options: WebServerOptions = {}) {
    this.chatId = options.chatId ?? WEB_CHAT_ID;
    this.userId = options.userId ?? WEB_USER_ID;
    this.mirrorTransports = options.mirrorTransports ?? {};
  }

  async handleApi(method: string, rawUrl: string, body?: unknown): Promise<ApiResponse> {
    const url = new URL(rawUrl, "http://localhost");
    if (method === "GET" && url.pathname === "/api/languages") {
      return json(200, { languages: this.manager.languages() });
    }

    if (url.pathname === "/api/chat" && method === "GET") {
      const language = url.searchParams.get("language") ?? "spanish";
      if (!this.manager.hasLanguage(language)) return json(404, { error: `Unknown language: ${language}` });
      const messages = await this.manager.getChatHistory(language, this.chatId);
      return json(200, { language, messages });
    }

    if (url.pathname === "/api/chat" && method === "POST") {
      const payload = body as { language?: string; text?: string } | undefined;
      const language = payload?.language ?? "spanish";
      const text = (payload?.text ?? "").trim();
      if (!this.manager.hasLanguage(language)) return json(404, { error: `Unknown language: ${language}` });
      if (!text) return json(400, { error: "text is required" });
      const reply = await this.manager.handleMessage(language, this.chatId, this.userId, text);
      const mirror = this.mirrorTransports[language];
      if (mirror) {
        await mirror.sendMessage(this.chatId, `🌐 Web: ${text}`);
        if (reply) await mirror.sendMessage(this.chatId, reply);
      }
      const messages = await this.manager.getChatHistory(language, this.chatId);
      return json(200, { language, reply, messages });
    }

    if (url.pathname === "/api/settings" && method === "GET") {
      return json(200, { languages: this.manager.languages(), chatId: this.chatId });
    }

    return json(404, { error: "Not found" });
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

function json(status: number, data: unknown): ApiResponse {
  return { status, contentType: "application/json; charset=utf-8", body: JSON.stringify(data) };
}

function html(body: string): ApiResponse {
  return { status: 200, contentType: "text/html; charset=utf-8", body };
}

function js(body: string): ApiResponse {
  return { status: 200, contentType: "application/javascript; charset=utf-8", body };
}

function staticIndex(): ApiResponse {
  const indexPath = path.join(WEB_DIST_DIR, "index.html");
  if (!fs.existsSync(indexPath)) {
    return html('<!doctype html><html><body><div id="root"></div><p>Web UI assets are missing. Run <code>npm run build:web</code>.</p></body></html>');
  }
  return html(fs.readFileSync(indexPath, "utf8"));
}

function staticAsset(urlPath: string): ApiResponse {
  const relative = decodeURIComponent(urlPath.replace(/^\/assets\//, ""));
  const assetPath = path.join(WEB_DIST_DIR, "assets", relative);
  const assetRoot = path.join(WEB_DIST_DIR, "assets");
  if (!assetPath.startsWith(assetRoot) || !fs.existsSync(assetPath)) return json(404, { error: "Asset not found" });
  const body = fs.readFileSync(assetPath, "utf8");
  if (assetPath.endsWith(".css")) return css(body);
  if (assetPath.endsWith(".js")) return js(body);
  return { status: 200, contentType: "application/octet-stream", body };
}

function css(body: string): ApiResponse {
  return { status: 200, contentType: "text/css; charset=utf-8", body };
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}
