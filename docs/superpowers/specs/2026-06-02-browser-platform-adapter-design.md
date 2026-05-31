# Browser Platform Adapter Design

**Date:** 2026-06-02  
**Status:** Approved

## Problem

`web/src/languages/spanish/index.ts` is a manually-maintained duplicate of `src/languages/spanish/index.ts`. It omits frequency data (`frequency.txt`, `cefr.tsv`) and has slightly abbreviated prompts. Every change to the canonical config must be manually mirrored. The `lemmas.txt` (10.6MB) is too large to bundle and is omitted silently.

The `fs`, `pino`, and `path` browser shims are already in place and working via Vite aliases. The only missing piece is a clean seam for file assets.

## Goal

- Single source of truth for `src/languages/spanish/index.ts`
- Frequency + CEFR data available in the browser (bundled via Vite `?raw`)
- Lemmatization degrades gracefully in browser (passthrough, no bundle cost)
- Delete the duplicate browser config

## Architecture

```
src/languages/spanish/
  assets.ts          ← NEW: Node adapter (reads fs)
  index.ts           ← MODIFIED: imports from ./assets instead of inline fs calls
  cefr.ts            ← unchanged
  lemmatize.ts       ← unchanged (graceful degradation in browser)

web/src/languages/spanish/
  assets.ts          ← NEW: Browser adapter (?raw imports)
  soul.md            ← existing, kept
  index.ts           ← DELETED
  config.ts          ← DELETED (unused)

web/vite.config.ts   ← MODIFIED: alias assets.ts instead of index.ts
```

## Components

### `src/languages/spanish/assets.ts` (Node)

Exports two functions used by `index.ts`:

```ts
export function loadFrequency(): {
  topWords: string[]
  lemmatize: (word: string) => string
  cefrLevels: ReadonlyMap<string, CefrLevel>
}

export function loadSoulContent(): string
```

Implementation reads from disk via `fs` + `__dirname`, same as the current inline calls.

### `web/src/languages/spanish/assets.ts` (Browser)

Same interface, different implementation:

- `frequency.txt` and `cefr.tsv` imported as `?raw` strings from `src/languages/spanish/` via relative path
- `soul.md` imported as `?raw` from `./soul.md` (existing file)
- `cefrLevels` parsed inline from `cefrRaw` (same logic as `cefr.ts`)
- `lemmatize` is `(w) => w` (passthrough — `lemmas.txt` is 10.6MB, not bundled)

### `src/languages/spanish/index.ts` (unified)

Replace the two inline `fs.readFileSync` expressions:

```ts
// Before:
topWords: fs.readFileSync(path.join(__dirname, "frequency.txt"), "utf8").split(/\s+/).filter(Boolean),
// ...
cefrLevels: loadCefrLevels(),
soulPath: path.resolve(__dirname, "soul.md"),

// After:
import { loadFrequency, loadSoulContent } from './assets'
// ...
frequency: { source: "...", ...loadFrequency() },
soulContent: loadSoulContent(),
soulPath: path.join(__dirname, "soul.md"),  // kept for Node PromptBuilder fallback
```

Remove `import fs` and `import path` from `index.ts` if no longer used.  
Remove `import { lemmatize }` from top-level (moved into `assets.ts`).  
Remove `import { loadCefrLevels }` from top-level (moved into `assets.ts`).

### `web/vite.config.ts`

```ts
// Remove:
{
  find: path.resolve(root, 'src/languages/spanish/index.ts'),
  replacement: path.resolve(__dirname, 'src/languages/spanish/index.ts'),
},

// Add:
{
  find: path.resolve(root, 'src/languages/spanish/assets.ts'),
  replacement: path.resolve(__dirname, 'src/languages/spanish/assets.ts'),
},
```

## Data Flow

**Node:**
`index.ts` → `assets.ts` (Node) → `fs.readFileSync` → files on disk

**Browser:**
`index.ts` → `assets.ts` (aliased to browser version) → bundled `?raw` strings  
`cefr.ts` still imported by Node path but bypassed in browser — browser `assets.ts` builds `cefrLevels` directly  
`lemmatize.ts` loaded in browser, `fs.readFileSync` hits shim → returns `''` → empty map → passthrough

**PromptBuilder** uses `lang.soulContent ?? fs.readFileSync(lang.soulPath)` — no change needed; `soulContent` is now populated in both environments.

## Edge Cases

| Scenario | Behavior |
|---|---|
| `lemmas.txt` in browser | Not bundled. `lemmatize()` returns word unchanged. Frequency ranking works; no lemma normalization. |
| `cefr.ts` in browser | `loadCefrLevels()` never called from `index.ts` in browser (browser `assets.ts` builds map directly). `cefr.ts` is dead code in browser — harmless. |
| `soul.md` path mismatch | `soulContent` is set, so `PromptBuilder` never reads `soulPath` in browser. |

## Dogfood Phase

After implementation:
1. `cd web && npm run dev`
2. Use `agent-browser` to open the app, complete onboarding, send messages
3. Check browser console for errors
4. Fix any issues found
5. Repeat until no errors

## Files to Delete

- `web/src/languages/spanish/index.ts`
- `web/src/languages/spanish/config.ts`
