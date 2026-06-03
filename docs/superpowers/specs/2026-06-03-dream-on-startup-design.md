# Dream on Startup — Design Spec

**Date:** 2026-06-03  
**Status:** Approved

## Problem

When the app is down at the scheduled dream time (default 11pm), the nightly dream is silently missed. On next startup there is no catch-up mechanism.

## Goal

Run `DreamService.run()` automatically at app startup if the dream is overdue, without running it on a fresh install where there is no prior data.

## Overdue Definition

- `last_dream_date` absent → fresh install, skip
- `last_dream_date` < today (in configured timezone) → overdue, run
- `last_dream_date` = today → already ran, skip

## Components

### 1. `MetaRepository` interface

Added to `src/repositories/interfaces.ts`:

```ts
export interface MetaRepository {
  getMetaValue(key: string): Promise<string | null>;
  setMetaValue(key: string, value: string): Promise<void>;
}
```

### 2. `BuddyDb` implements `MetaRepository`

Two synchronous SQL operations against the existing `_buddy_meta` table (already in schema):

- `getMetaValue(key)` → `SELECT value FROM _buddy_meta WHERE key = ?`
- `setMetaValue(key, value)` → `INSERT OR REPLACE INTO _buddy_meta (key, value) VALUES (?, ?)`

`BuddyDb` is added to the `implements` clause and the two methods are added.

### 3. `DreamService` tracks last run date

Constructor gains a `MetaRepository` dependency and the config gains a `langId: string` field.

After a successful `run()` call (before returning), write:
```
key:   last_dream_date:${langId}
value: YYYY-MM-DD  (in configured timezone)
```

Both the cron path and the startup path go through `DreamService.run()`, so the date stays in sync automatically.

### 4. Startup check in `startup.ts`

New exported function:

```ts
export async function runDreamIfOverdue(
  config: Config,
  rt: LanguageRuntime,
  db: MetaRepository,
): Promise<void>
```

Logic:
1. Compute today's date string `YYYY-MM-DD` in `config.timezone`.
2. Read `last_dream_date:${rt.lang.id}` from `db`.
3. If value is null or value >= today → return (no-op).
4. Fire `rt.dreamService.run()` in the background (`.then` / `.catch` with logging, no await).

Called from `index.ts` after all runtimes are initialised, once per language.

## Data Flow

```
app start
  → for each language: runDreamIfOverdue(config, rt, db)
      → last_dream_date:lang absent → skip
      → last_dream_date:lang < today → dreamService.run()
          → success → setMetaValue('last_dream_date:lang', today)
          → error   → logged, not fatal

nightly cron fires → dreamService.run()
    → success → setMetaValue('last_dream_date:lang', today)
```

## No Schema Changes

`_buddy_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)` already exists.

## Out of Scope

- Catching up multiple missed nights (dream only processes today's messages)
- Blocking startup on dream completion (fire-and-forget)
- Changing the dream cron schedule
