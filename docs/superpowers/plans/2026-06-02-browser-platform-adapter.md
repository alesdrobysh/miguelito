# Browser Platform Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract file-loading from `src/languages/spanish/index.ts` into a platform adapter (`assets.ts`) so the same source works in Node and browser — eliminating the duplicate `web/src/languages/spanish/index.ts` and adding frequency/CEFR data to the browser.

**Architecture:** A new `assets.ts` module per platform exports `loadFrequency()` and `loadSoulContent()`. Node reads from disk via `fs`; browser imports `frequency.txt` and `cefr.tsv` as bundled `?raw` strings. Vite aliases the `assets.ts` file only; `index.ts`, `cefr.ts`, and `lemmatize.ts` are shared unchanged.

**Tech Stack:** TypeScript (CommonJS, Node16 module), Vite `?raw` imports, existing `fs`/`pino`/`path` browser shims already in `web/src/browser-shims/`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| CREATE | `src/languages/spanish/assets.ts` | Node: load frequency.txt, cefr.tsv, soul.md via fs |
| CREATE | `web/src/languages/spanish/assets.ts` | Browser: same interface via ?raw bundled imports |
| MODIFY | `src/languages/spanish/index.ts` | Import from ./assets instead of inline fs calls |
| MODIFY | `web/vite.config.ts` | Alias assets.ts instead of index.ts |
| DELETE | `web/src/languages/spanish/index.ts` | Replaced by single canonical index.ts |
| DELETE | `web/src/languages/spanish/config.ts` | Unused, was dead code |

---

### Task 1: Create the Node assets adapter

**Files:**
- Create: `src/languages/spanish/assets.ts`

- [ ] **Step 1: Create `src/languages/spanish/assets.ts`**

```typescript
import fs from "fs";
import path from "path";
import { lemmatize } from "./lemmatize.js";
import { loadCefrLevels } from "./cefr.js";
import type { CefrLevel } from "../../domain/frequency.js";

export interface FrequencyData {
  topWords: readonly string[];
  lemmatize: (word: string) => string;
  cefrLevels: ReadonlyMap<string, CefrLevel>;
}

export function loadFrequency(): FrequencyData {
  return {
    topWords: fs.readFileSync(path.join(__dirname, "frequency.txt"), "utf8").split(/\s+/).filter(Boolean),
    lemmatize,
    cefrLevels: loadCefrLevels(),
  };
}

export function loadSoulContent(): string {
  return fs.readFileSync(path.join(__dirname, "soul.md"), "utf8");
}
```

- [ ] **Step 2: Verify TypeScript compiles (no errors introduced)**

```bash
npx tsc --noEmit
```

Expected: no new errors (one pre-existing unrelated test failure is OK).

---

### Task 2: Refactor index.ts to use the Node assets adapter

**Files:**
- Modify: `src/languages/spanish/index.ts`

- [ ] **Step 1: Replace the top-level imports and inline fs calls**

The current file starts with:
```typescript
import fs from "fs";
import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";
import { lemmatize } from "./lemmatize.js";
import { loadCefrLevels } from "./cefr.js";
```

Replace with:
```typescript
import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";
import { loadFrequency, loadSoulContent } from "./assets.js";
```

- [ ] **Step 2: Replace the `frequency` field and `soulPath` at the bottom of the file**

Find (near end of file):
```typescript
  frequency: {
    source: "hermitdave/FrequencyWords OpenSubtitles 2018 es_50k + PCIC CEFR levels",
    topWords: fs.readFileSync(path.join(__dirname, "frequency.txt"), "utf8").split(/\s+/).filter(Boolean),
    lemmatize,
    cefrLevels: loadCefrLevels(),
  },
  soulPath: path.resolve(__dirname, "soul.md"),
```

Replace with:
```typescript
  frequency: {
    source: "hermitdave/FrequencyWords OpenSubtitles 2018 es_50k + PCIC CEFR levels",
    ...loadFrequency(),
  },
  soulContent: loadSoulContent(),
  soulPath: path.resolve(__dirname, "soul.md"),
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Run the existing test suite — must still pass**

```bash
npm test
```

Expected: same result as baseline — 160 passing, 1 pre-existing failure in `AgentRunner.test.ts` (unrelated to this change). The `loadLanguage` / `soulPath` / prompt content tests must all pass.

- [ ] **Step 5: Commit**

```bash
git add src/languages/spanish/assets.ts src/languages/spanish/index.ts
git commit -m "refactor: extract Spanish asset loading into platform adapter"
```

---

### Task 3: Create the browser assets adapter

**Files:**
- Create: `web/src/languages/spanish/assets.ts`

The browser adapter imports `frequency.txt` and `cefr.tsv` as raw strings from the canonical `src/` location (4 levels up from `web/src/languages/spanish/`). `lemmatize` is a passthrough — `lemmas.txt` is 10.6 MB and is not bundled.

- [ ] **Step 1: Create `web/src/languages/spanish/assets.ts`**

```typescript
import frequencyRaw from '../../../../src/languages/spanish/frequency.txt?raw'
import cefrRaw from '../../../../src/languages/spanish/cefr.tsv?raw'
import soulContent from './soul.md?raw'
import type { CefrLevel } from '../../../../src/domain/frequency.js'

const VALID_LEVELS = new Set<CefrLevel>(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])

// Return type is inferred — do NOT import FrequencyData from assets.ts,
// that path is Vite-aliased back to this file (circular).
export function loadFrequency() {
  const topWords = frequencyRaw.split(/\s+/).filter(Boolean)

  const cefrLevels = new Map<string, CefrLevel>()
  for (const line of cefrRaw.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const word = line.slice(0, tab).trim()
    const level = line.slice(tab + 1).trim() as CefrLevel
    if (word && VALID_LEVELS.has(level)) cefrLevels.set(word, level)
  }

  return { topWords, lemmatize: (w: string) => w, cefrLevels }
}

export function loadSoulContent(): string {
  return soulContent
}
```

- [ ] **Step 2: Verify the web TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

### Task 4: Update the Vite alias and delete duplicates

**Files:**
- Modify: `web/vite.config.ts`
- Delete: `web/src/languages/spanish/index.ts`
- Delete: `web/src/languages/spanish/config.ts`

- [ ] **Step 1: Open `web/vite.config.ts` and swap the Spanish language alias**

Find:
```typescript
      // Redirect server-side Spanish language to browser version (no fs at load time)
      {
        find: path.resolve(root, 'src/languages/spanish/index.ts'),
        replacement: path.resolve(__dirname, 'src/languages/spanish/index.ts'),
      },
```

Replace with:
```typescript
      // Redirect Spanish asset loading to browser adapter (?raw instead of fs)
      {
        find: path.resolve(root, 'src/languages/spanish/assets.ts'),
        replacement: path.resolve(__dirname, 'src/languages/spanish/assets.ts'),
      },
```

- [ ] **Step 2: Delete the now-redundant browser-specific language files**

```bash
rm web/src/languages/spanish/index.ts
rm web/src/languages/spanish/config.ts
```

- [ ] **Step 3: Verify the web build succeeds**

```bash
cd web && npm run build 2>&1
```

Expected: build completes with no errors. Warnings about chunk size for frequency data are OK.

- [ ] **Step 4: Commit**

```bash
git add web/vite.config.ts
git rm web/src/languages/spanish/index.ts web/src/languages/spanish/config.ts
git commit -m "feat: add frequency/CEFR data to browser via platform adapter, remove duplicate config"
```

---

### Task 5: Dogfood with agent-browser

**Goal:** Verify the web app works end-to-end: loads, completes onboarding, sends messages, no console errors.

- [ ] **Step 1: Start the dev server**

```bash
cd web && npm run dev
```

Note the port (default: `http://localhost:5173`).

- [ ] **Step 2: Use agent-browser to open the app**

Invoke `agent-browser` skill. Navigate to `http://localhost:5173`. Take a screenshot.

- [ ] **Step 3: Complete onboarding**

Walk through all onboarding steps. If the app shows `#dev` shortcut (skip onboarding by appending `#dev` to URL), use it if model download would be too slow.

For the `#dev` shortcut: navigate to `http://localhost:5173/#dev` — this skips onboarding and goes straight to chat if `onboardingComplete` is already set in IndexedDB, OR sets the phase directly to chat in dev mode.

- [ ] **Step 4: Send a test message and verify response**

Type a message like `"Hola, soy estudiante de español."` and verify:
- A response appears in Spanish
- No errors in the browser console
- No `[Error: ...]` bubbles in the chat UI

- [ ] **Step 5: Check browser console for errors**

In agent-browser, run `document.querySelectorAll('.error')` or check the console output for any red errors.

- [ ] **Step 6: Fix any errors found and repeat from Step 2 until clean**

Common things to watch for:
- Vite alias resolution failures (check that `assets.ts` paths resolve)
- `?raw` import errors for `.txt` or `.tsv` files
- Runtime errors in `BrowserRuntime.ts` during `createBrowserRuntime()`

- [ ] **Step 7: Commit any fixes**

```bash
git add -p
git commit -m "fix: <describe what was broken>"
```
