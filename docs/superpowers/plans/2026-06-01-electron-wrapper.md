# Electron Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing Miguelito Node.js + React web UI into a distributable macOS Electron app.

**Architecture:** Electron main process starts the existing `WebServer` (Node.js backend) on localhost:8787, then opens a frameless `BrowserWindow` with `titleBarStyle: 'hiddenInset'` that loads that URL. The renderer communicates with the backend via HTTP — no IPC introduced. A preload script injects an `electron-app` CSS class that enables drag-to-move and traffic-light padding.

**Tech Stack:** Electron, electron-builder, TypeScript (separate tsconfig for electron main), Vite (existing), React (existing).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `electron/main.ts` | Create | Main process: set env, start WebServer, create BrowserWindow |
| `electron/preload.ts` | Create | Inject `electron-app` class on `<html>` for CSS targeting |
| `tsconfig.electron.json` | Create | TS config for electron/ → dist-electron/ |
| `electron-builder.yml` | Create | macOS dmg + zip packaging config |
| `package.json` | Modify | Add `main`, deps, `electron:dev` / `electron:build` scripts |
| `web/src/styles.css` | Modify | Drag region + traffic-light padding (`.electron-app` scoped) |
| `.gitignore` | Modify | Ignore `dist-electron/` and `release/` |

---

### Task 1: Update .gitignore and install Electron dependencies

**Files:**
- Modify: `.gitignore`
- Modify: `package.json` (deps only — scripts and main field come in Task 5)

- [ ] **Step 1: Add generated dirs to .gitignore**

Append to `.gitignore`:
```
dist-electron/
release/
```

- [ ] **Step 2: Install electron and electron-builder**

```bash
npm install --save-dev electron electron-builder
```

Expected: resolves without error, `package-lock.json` updated.

- [ ] **Step 3: Commit**

```bash
git add .gitignore package.json package-lock.json
git commit -m "chore: install electron and electron-builder"
```

---

### Task 2: Create tsconfig.electron.json

**Files:**
- Create: `tsconfig.electron.json`

The electron main process uses CommonJS (Electron's built-in require). We do NOT extend the base tsconfig because that uses `module: Node16` which conflicts.

- [ ] **Step 1: Create the file**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist-electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["electron/**/*.ts"]
}
```

- [ ] **Step 2: Verify tsc picks it up (no source files yet, just verify config parses)**

```bash
npx tsc -p tsconfig.electron.json --listFiles 2>&1 | head -5
```

Expected: no config parse errors (may say "no input files" — that's fine).

- [ ] **Step 3: Commit**

```bash
git add tsconfig.electron.json
git commit -m "chore: add tsconfig for electron main process"
```

---

### Task 3: Create electron/preload.ts

**Files:**
- Create: `electron/preload.ts`

The preload runs in the renderer's context before page scripts. It injects `electron-app` on `<html>` so CSS can scope Electron-only styles (drag region, traffic-light padding). No Node.js APIs used — just DOM.

- [ ] **Step 1: Create electron/preload.ts**

```typescript
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron-app');
});
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: add electron preload script"
```

---

### Task 4: Create electron/main.ts

**Files:**
- Create: `electron/main.ts`

Main process responsibilities:
1. Set `DATA_DIR` and `TRANSPORT` env vars before the backend reads them.
2. Load `.env` from `app.getPath('userData')` (where API keys live on user's machine).
3. Dynamically `require()` the compiled backend from `dist/` via `app.getAppPath()` — this works in both dev and packaged app.
4. Start `WebServer`.
5. Create a frameless `BrowserWindow` with macOS traffic lights (`titleBarStyle: 'hiddenInset'`).
6. On error, show a native dialog with instructions and quit.

- [ ] **Step 1: Create electron/main.ts**

```typescript
import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import dotenv from 'dotenv';

interface MinimalServer {
  stop(): void;
}

let webServer: MinimalServer | null = null;

async function startBackend(): Promise<void> {
  const userData = app.getPath('userData');

  // Must be set before loadConfig() reads process.env
  process.env.DATA_DIR = userData;
  process.env.TRANSPORT = 'web';

  // Load API keys from userData/.env (e.g. OPENROUTER_API_KEY=...)
  dotenv.config({ path: path.join(userData, '.env') });

  const appRoot = app.getAppPath();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadConfig } = require(path.join(appRoot, 'dist/infrastructure/config')) as {
    loadConfig(): { webHost: string; webPort: number };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRuntimeManager } = require(path.join(appRoot, 'dist/runtime')) as {
    createRuntimeManager(config: unknown): Promise<unknown>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebServer } = require(path.join(appRoot, 'dist/web/WebServer')) as {
    WebServer: new (manager: unknown) => { start(host: string, port: number): void; stop(): void };
  };

  const config = loadConfig();
  const manager = await createRuntimeManager(config);
  const server = new WebServer(manager);
  server.start(config.webHost, config.webPort);
  webServer = server;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 420,
    height: 820,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('http://127.0.0.1:8787');
}

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const envPath = path.join(app.getPath('userData'), '.env');
    dialog.showErrorBox(
      'Miguelito — Configuration Error',
      `Failed to start: ${msg}\n\nCreate ${envPath} with:\nOPENROUTER_API_KEY=your_key_here`,
    );
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  webServer?.stop();
  app.quit();
});
```

- [ ] **Step 2: Verify it compiles (no emit — backend not built yet)**

```bash
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: no errors. (The `require()` paths are strings so TypeScript doesn't validate them.)

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: add electron main process"
```

---

### Task 5: Update package.json — main field and scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `main` field and new scripts**

Open `package.json`. Add `"main": "dist-electron/main.js"` at the top level (alongside `"name"`, `"version"`, etc.).

Add these two scripts inside `"scripts"`:
```json
"electron:dev": "npm run build && rm -rf dist-electron && tsc -p tsconfig.electron.json && electron .",
"electron:build": "npm run build && rm -rf dist-electron && tsc -p tsconfig.electron.json && electron-builder"
```

The full `scripts` block should be:
```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "build": "rm -rf dist && npm run build:web && tsc -p tsconfig.build.json && cd src && find languages -name \"soul.md\" -o -path \"languages/frequency/*.txt\" | rsync -R --files-from=- . ../dist/",
  "build:web": "vite build",
  "design:detect": "impeccable detect --gpt --gemini web dist/web",
  "start": "node dist/index.js",
  "typecheck": "tsc --noEmit",
  "db:consolidate": "tsx scripts/consolidate-db.ts",
  "test": "npm run build:web && vitest run",
  "electron:dev": "npm run build && rm -rf dist-electron && tsc -p tsconfig.electron.json && electron .",
  "electron:build": "npm run build && rm -rf dist-electron && tsc -p tsconfig.electron.json && electron-builder"
}
```

- [ ] **Step 2: Verify package.json is valid JSON**

```bash
node -e "require('./package.json'); console.log('valid')"
```

Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add electron scripts and main entry point"
```

---

### Task 6: Update web/src/styles.css — drag region and traffic-light padding

**Files:**
- Modify: `web/src/styles.css`

The `.electron-app` class is injected by the preload on `<html>`. CSS rules scoped to `.electron-app` only apply inside the Electron window, not when the web server is accessed via browser.

The macOS traffic lights span roughly 68px from the left edge of the window. The phone frame is 420px wide and centered. We shift `.chat-header` content right with `padding-left: 80px` to clear the traffic lights. The grid currently has `grid-template-columns: 44px 1fr minmax(112px, auto) 42px` — we override this column widths aren't needed, just the left padding.

- [ ] **Step 1: Append Electron-specific rules to the end of web/src/styles.css**

Append exactly this block at the end of the file (after the last existing rule):

```css
/* Electron: window drag region and traffic-light clearance */
.electron-app .chat-header {
  -webkit-app-region: drag;
  padding-left: 80px;
}
.electron-app .chat-header button,
.electron-app .chat-header select,
.electron-app .chat-header input {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 2: Verify build:web succeeds**

```bash
npm run build:web
```

Expected: exits 0, `dist/web/` contains `index.html` and `assets/`.

- [ ] **Step 3: Commit**

```bash
git add web/src/styles.css
git commit -m "feat: add electron drag region and traffic-light padding to header"
```

---

### Task 7: Create electron-builder.yml

**Files:**
- Create: `electron-builder.yml`

`asarUnpack` for `sql.js` is required because the WASM file cannot be loaded from inside an asar archive — it must be on the filesystem.

- [ ] **Step 1: Create electron-builder.yml**

```yaml
appId: com.miguelito.app
productName: Miguelito
directories:
  output: release
files:
  - dist/**
  - dist-electron/**
  - node_modules/**
  - package.json
asarUnpack:
  - node_modules/sql.js/**
mac:
  target:
    - target: dmg
    - target: zip
  category: public.app-category.education
```

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "feat: add electron-builder config for macOS dmg"
```

---

### Task 8: Smoke test — run electron:dev

**Files:** none (verification only)

This task verifies everything wires together: backend starts, window loads, UI is functional.

Prerequisites: you need a `.env` file with at least `OPENROUTER_API_KEY=<key>` in `~/Library/Application Support/Miguelito/.env`. The quickest way for testing is to copy your existing `.env`:

```bash
mkdir -p ~/Library/Application\ Support/Miguelito
cp .env ~/Library/Application\ Support/Miguelito/.env
```

- [ ] **Step 1: Run the app**

```bash
npm run electron:dev
```

Expected sequence:
1. Vite builds `dist/web/`
2. tsc compiles backend to `dist/`
3. tsc compiles `electron/` to `dist-electron/`
4. Electron window opens at 420×820px with macOS traffic lights
5. Chat UI loads, shows "Loading conversation…" then the welcome card or history

- [ ] **Step 2: Verify drag works**

Click and drag the header area (between the hamburger button and the identity/language controls) — the window should move.

- [ ] **Step 3: Verify traffic lights don't overlap content**

The hamburger button and text in the header should be visible to the right of the traffic lights, not obscured.

- [ ] **Step 4: Verify chat works**

Type a message in Spanish and send it. Verify a response comes back.

- [ ] **Step 5: Commit any fixes needed**

If something needed a tweak, commit the fix:
```bash
git add -A
git commit -m "fix: <description of fix>"
```

---

### Task 9: Build the distributable .dmg

**Files:** none (build verification)

- [ ] **Step 1: Run the packager**

```bash
npm run electron:build
```

Expected: exits 0, `release/` directory contains `Miguelito-*.dmg` and `Miguelito-*.zip`.

This takes 1-3 minutes. If electron-builder warns about missing icon, that's acceptable — it will use a default Electron icon.

- [ ] **Step 2: Verify the .dmg**

```bash
open release/Miguelito-*.dmg
```

Drag `Miguelito.app` to Applications (or just double-click to open). Verify it launches and the chat UI works.

- [ ] **Step 3: Final commit**

```bash
git add release/.gitkeep 2>/dev/null; true
git commit --allow-empty -m "feat: electron wrapper complete — builds macOS dmg"
```

---

## Notes

**Icon:** To add a custom icon, place a 1024×1024 PNG at `build/icon.png`. electron-builder will auto-convert it. Without it, the default Electron icon is used.

**First-launch .env:** On a fresh machine, copy your `.env` to `~/Library/Application Support/Miguelito/.env`. The app shows a native error dialog with the path if it can't find the config.

**Port conflict:** If port 8787 is in use, the app will show an error dialog. The port is configured via `WEB_PORT` in the `.env` file.
