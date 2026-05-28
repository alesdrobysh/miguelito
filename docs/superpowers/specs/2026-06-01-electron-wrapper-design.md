# Electron Wrapper for Miguelito Web UI

**Date**: 2026-06-01  
**Status**: Approved

## Overview

Wrap the existing Miguelito web UI into a distributable macOS Electron desktop app. The app embeds the existing Node.js `WebServer` in the Electron main process and loads it in a frameless `BrowserWindow`. No changes to backend logic or frontend API calls.

## Architecture

```
Electron main process
  ├── sets DATA_DIR → app.getPath('userData')
  ├── calls dotenv.config({ path: userData/.env })
  ├── starts WebServer on localhost:8787
  └── creates BrowserWindow (frameless, hiddenInset) → http://localhost:8787

Renderer process
  └── existing React SPA — communicates via HTTP /api/* unchanged
```

Communication between renderer and backend remains HTTP; no Electron IPC is introduced.

## New Files

### `electron/main.ts`

Electron main process entry point:

1. Set `process.env.DATA_DIR` to `app.getPath('userData')` before any imports that read config.
2. Load `.env` from `app.getPath('userData')/.env` via `dotenv.config()`.
3. Import and start `WebServer` on `127.0.0.1:8787`.
4. On `app.whenReady()`, create a `BrowserWindow`:
   - `width: 420, height: 820`
   - `titleBarStyle: 'hiddenInset'` (macOS native traffic lights, no title text)
   - `frame: false` is NOT used — `titleBarStyle: 'hiddenInset'` handles this on macOS
   - `webPreferences: { preload, contextIsolation: true, nodeIntegration: false }`
5. Load `http://localhost:8787`.
6. On `window-all-closed`, quit the app (and stop the WebServer).

### `electron/preload.ts`

Minimal preload — no `contextBridge` APIs needed since the renderer talks HTTP, not IPC. File exists for security best practice (contextIsolation: true requires a preload path).

### `tsconfig.electron.json`

TypeScript config for the electron main process:
- `extends`: base `tsconfig.json`
- `module`: `commonjs`
- `outDir`: `dist-electron`
- `include`: `["electron/**/*.ts"]`
- `exclude`: `["node_modules", "web", "src"]`

### `electron-builder.yml`

```yaml
appId: com.miguelito.app
productName: Miguelito
directories:
  output: release
files:
  - dist/**
  - dist-electron/**
  - node_modules/**
mac:
  target: [dmg, zip]
  icon: build/icon.icns
  category: public.app-category.education
```

### `build/icon.icns`

App icon. Placeholder — user provides a 1024×1024 PNG; `electron-builder` converts via `iconutil` or the user generates the `.icns` manually.

## Changes to Existing Files

### `package.json`

Add to `devDependencies`:
- `electron` (latest stable)
- `electron-builder`

Add `main` field: `"dist-electron/main.js"`

Add scripts:
- `"electron:dev"`: `npm run build && electron .`
- `"electron:build"`: `npm run build && tsc -p tsconfig.electron.json && electron-builder`

### `web/src/styles.css`

Add drag region for the frameless window. The `.chat-header` becomes the drag handle; interactive elements inside it opt out:

```css
.chat-header {
  -webkit-app-region: drag;
}
.chat-header button,
.chat-header select,
.chat-header input {
  -webkit-app-region: no-drag;
}
```

Also add `padding-left` to accommodate the macOS traffic light buttons (approximately 72px) when running under Electron. The main process sets `process.env.ELECTRON=1`; the renderer can detect `window.process` absence and use a CSS class injected by the preload, or simply always reserve the space since the web UI isn't expected to be used in a regular browser simultaneously.

Simpler approach: always reserve the traffic light space in `.chat-header` via a fixed left padding, since this CSS only ships in the Electron-bundled build anyway.

## Data & Config

- **Data directory**: `~/Library/Application Support/Miguelito/` (via `app.getPath('userData')`)
- **Environment variables**: read from `~/.../Miguelito/.env`. On first launch, if `.env` is absent, the app should show a message in the window directing the user to create it. The `WebServer` will fail to start without `OPENROUTER_API_KEY`; the main process catches the error and shows a native dialog.
- **Transport**: Main process sets `process.env.TRANSPORT=web` to ensure the backend starts in web mode.

## Error Handling

- If `WebServer` fails to start (bad config, port conflict), main process catches the error and shows `dialog.showErrorBox()` with actionable instructions, then quits.
- Port conflict: if 8787 is occupied, the error message tells the user.

## Build Pipeline

```bash
npm run build             # existing: vite build + tsc (backend)
tsc -p tsconfig.electron.json   # compile electron/main.ts → dist-electron/
electron-builder          # package → release/
```

Wrapped as: `npm run electron:build`

## Out of Scope

- Windows / Linux support (macOS only for now)
- Auto-updater
- Code signing / notarization (can be added later)
- Tray icon / menu bar mode
- Multiple windows
