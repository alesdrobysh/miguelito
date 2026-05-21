import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";
import type { RuntimeManager } from "../runtime.js";

export interface ApiResponse {
  status: number;
  contentType: string;
  body: string;
}

const WEB_CHAT_ID = 0;
const WEB_USER_ID = "web-user";
const WEB_DIST_DIR = path.join(process.cwd(), "src", "web", "dist");

export class WebServer {
  private server: http.Server | null = null;

  constructor(private manager: RuntimeManager) {}

  async handleApi(method: string, rawUrl: string, body?: unknown): Promise<ApiResponse> {
    const url = new URL(rawUrl, "http://localhost");
    if (method === "GET" && url.pathname === "/api/languages") {
      return json(200, { languages: this.manager.languages() });
    }

    if (url.pathname === "/api/chat" && method === "GET") {
      const language = url.searchParams.get("language") ?? "spanish";
      if (!this.manager.hasLanguage(language)) return json(404, { error: `Unknown language: ${language}` });
      const messages = await this.manager.getChatHistory(language, WEB_CHAT_ID);
      return json(200, { language, messages });
    }

    if (url.pathname === "/api/chat" && method === "POST") {
      const payload = body as { language?: string; text?: string } | undefined;
      const language = payload?.language ?? "spanish";
      const text = (payload?.text ?? "").trim();
      if (!this.manager.hasLanguage(language)) return json(404, { error: `Unknown language: ${language}` });
      if (!text) return json(400, { error: "text is required" });
      const reply = await this.manager.handleMessage(language, WEB_CHAT_ID, WEB_USER_ID, text);
      const messages = await this.manager.getChatHistory(language, WEB_CHAT_ID);
      return json(200, { language, reply, messages });
    }

    if (url.pathname === "/api/settings" && method === "GET") {
      return json(200, { languages: this.manager.languages(), chatId: WEB_CHAT_ID });
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

function shell(title: string, active: "chat" | "settings", main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body data-page="${active}">
  <aside class="sidebar">
    <div class="brand">Miguelito</div>
    <a class="nav ${active === "chat" ? "active" : ""}" href="/chat">Chat</a>
    <a class="nav ${active === "settings" ? "active" : ""}" href="/settings">Settings</a>
  </aside>
  <main class="main">${main}</main>
  <script src="/app.js"></script>
</body>
</html>`;
}

function chatHtml(): string {
  return shell("Miguelito Chat", "chat", `
    <section class="topbar">
      <div>
        <h1>Chat</h1>
        <p>Switch language to rerender that tutor's conversation.</p>
      </div>
      <label class="field compact">Language <select id="languageSelect"></select></label>
    </section>
    <section id="messages" class="messages"></section>
    <form id="chatForm" class="composer">
      <input id="messageInput" autocomplete="off" placeholder="Write a message…" />
      <button type="submit">Send</button>
    </form>`);
}

function settingsHtml(): string {
  return shell("Miguelito Settings", "settings", `
    <section class="topbar"><div><h1>Settings</h1><p>Local Web UI settings. Language changes are saved in this browser.</p></div></section>
    <section class="card">
      <label class="field">Default language <select id="settingsLanguageSelect"></select></label>
      <p class="muted">One Miguelito process serves all bundled languages. Chat state stays isolated per language.</p>
      <div id="settingsStatus" class="status"></div>
    </section>`);
}

function appJs(): string {
  return `const state = { languages: [], language: localStorage.getItem('miguelito.language') || 'spanish' };
const $ = (id) => document.getElementById(id);
async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function renderLanguageOptions(select) {
  if (!select) return;
  select.innerHTML = state.languages.map(l => '<option value="' + l.id + '">' + escapeHtml(l.name) + '</option>').join('');
  select.value = state.language;
}
async function loadLanguages() {
  const data = await api('/api/languages');
  state.languages = data.languages;
  if (!state.languages.some(l => l.id === state.language)) state.language = state.languages[0]?.id || 'spanish';
}
function renderMessages(messages) {
  const root = $('messages');
  if (!root) return;
  if (!messages.length) { root.innerHTML = '<div class="empty">No messages yet for this language.</div>'; return; }
  root.innerHTML = messages.map(m => '<article class="msg ' + m.role + '"><div class="role">' + escapeHtml(m.role) + '</div><div>' + escapeHtml(m.content).replace(/\\n/g, '<br>') + '</div></article>').join('');
  root.scrollTop = root.scrollHeight;
}
async function loadChat() {
  const data = await api('/api/chat?language=' + encodeURIComponent(state.language));
  renderMessages(data.messages);
}
async function initChat() {
  await loadLanguages();
  const select = $('languageSelect');
  renderLanguageOptions(select);
  select?.addEventListener('change', async () => {
    state.language = select.value;
    localStorage.setItem('miguelito.language', state.language);
    await loadChat();
  });
  $('chatForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('messageInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    renderMessages([...(document.querySelectorAll('.msg')).length ? [] : [], { role: 'user', content: text }, { role: 'assistant', content: '…' }]);
    const data = await api('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: state.language, text }) });
    renderMessages(data.messages);
  });
  await loadChat();
}
async function initSettings() {
  await loadLanguages();
  const select = $('settingsLanguageSelect');
  renderLanguageOptions(select);
  select?.addEventListener('change', () => {
    state.language = select.value;
    localStorage.setItem('miguelito.language', state.language);
    const status = $('settingsStatus');
    if (status) status.textContent = 'Saved default language: ' + state.language;
  });
}
if (document.body.dataset.page === 'chat') initChat().catch(err => alert(err.message));
if (document.body.dataset.page === 'settings') initSettings().catch(err => alert(err.message));`;
}

function stylesCss(): string {
  return `:root { color-scheme: dark; --bg:#0d1117; --panel:#161b22; --line:#30363d; --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff; }
* { box-sizing: border-box; } body { margin:0; display:flex; min-height:100vh; background:var(--bg); color:var(--text); font:16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.sidebar { width:220px; padding:24px 16px; background:var(--panel); border-right:1px solid var(--line); }
.brand { font-weight:800; font-size:22px; margin-bottom:24px; } .nav { display:block; padding:10px 12px; color:var(--text); text-decoration:none; border-radius:10px; margin-bottom:6px; } .nav.active, .nav:hover { background:#21262d; color:var(--accent); }
.main { flex:1; display:flex; flex-direction:column; max-height:100vh; } .topbar { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:24px; border-bottom:1px solid var(--line); }
h1 { margin:0 0 4px; } p { margin:0; color:var(--muted); } select, input, button { border:1px solid var(--line); border-radius:10px; background:#0d1117; color:var(--text); padding:10px 12px; } button { background:var(--accent); color:#06111f; font-weight:700; cursor:pointer; }
.field { display:flex; flex-direction:column; gap:8px; color:var(--muted); } .field.compact { min-width:190px; }
.messages { flex:1; overflow:auto; padding:24px; display:flex; flex-direction:column; gap:12px; } .msg { max-width:780px; padding:14px 16px; border-radius:16px; border:1px solid var(--line); background:var(--panel); } .msg.user { align-self:flex-end; background:#1f6feb22; } .msg.assistant { align-self:flex-start; } .role { color:var(--muted); font-size:12px; text-transform:uppercase; margin-bottom:4px; }
.composer { display:flex; gap:12px; padding:16px 24px 24px; border-top:1px solid var(--line); } .composer input { flex:1; }
.card { margin:24px; padding:20px; background:var(--panel); border:1px solid var(--line); border-radius:16px; max-width:640px; } .muted, .empty, .status { color:var(--muted); margin-top:12px; }
@media (max-width: 700px) { body { flex-direction:column; } .sidebar { width:auto; display:flex; gap:8px; align-items:center; } .brand { margin:0 auto 0 0; } .topbar { flex-direction:column; align-items:stretch; } }`;
}
