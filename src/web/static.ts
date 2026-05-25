import fs from "fs";
import path from "path";
import type { ApiResponse } from "./types.js";
import { json } from "./types.js";

const WEB_DIST_DIR = path.join(process.cwd(), "dist", "web");

function html(body: string): ApiResponse {
  return { status: 200, contentType: "text/html; charset=utf-8", body };
}

function js(body: string): ApiResponse {
  return { status: 200, contentType: "application/javascript; charset=utf-8", body };
}

function css(body: string): ApiResponse {
  return { status: 200, contentType: "text/css; charset=utf-8", body };
}

export function staticIndex(): ApiResponse {
  const indexPath = path.join(WEB_DIST_DIR, "index.html");
  if (!fs.existsSync(indexPath)) {
    return html('<!doctype html><html><body><div id="root"></div><p>Web UI assets are missing. Run <code>npm run build:web</code>.</p></body></html>');
  }
  return html(fs.readFileSync(indexPath, "utf8"));
}

export function staticAsset(urlPath: string): ApiResponse {
  const relative = decodeURIComponent(urlPath.replace(/^\/assets\//, ""));
  const assetPath = path.join(WEB_DIST_DIR, "assets", relative);
  const assetRoot = path.join(WEB_DIST_DIR, "assets");
  if (!assetPath.startsWith(assetRoot) || !fs.existsSync(assetPath)) return json(404, { error: "Asset not found" });
  const body = fs.readFileSync(assetPath, "utf8");
  if (assetPath.endsWith(".css")) return css(body);
  if (assetPath.endsWith(".js")) return js(body);
  return { status: 200, contentType: "application/octet-stream", body };
}
