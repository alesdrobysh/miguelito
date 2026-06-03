# Dream on Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `DreamService.run()` at app startup if the dream is overdue (last run date < today), skipping fresh installs where no date has been recorded yet.

**Architecture:** Add a `MetaRepository` interface with `getMetaValue`/`setMetaValue` backed by the existing `_buddy_meta` SQLite table. `DreamService` writes `last_dream_date:{langId}` = YYYY-MM-DD after every successful run (both cron and startup paths). A new `runDreamIfOverdue` helper in `startup.ts` reads that key and fires dream in the background when stale.

**Tech Stack:** TypeScript, sql.js (synchronous SQLite), vitest

---

### Task 1: Add `MetaRepository` interface and implement in `BuddyDb`

**Files:**
- Modify: `src/repositories/interfaces.ts` (append after `CompetencyRepository`)
- Modify: `src/infrastructure/db.ts` (implements clause + two methods)

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/db.meta.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "./db.js";

let tmpDir: string;
let db: BuddyDb;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-test-"));
  db = await BuddyDb.open(path.join(tmpDir, "buddy.db"), "shared", [], []);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MetaRepository", () => {
  it("returns null for an unknown key", async () => {
    expect(await db.getMetaValue("nonexistent")).toBeNull();
  });

  it("stores and retrieves a value", async () => {
    await db.setMetaValue("test_key", "hello");
    expect(await db.getMetaValue("test_key")).toBe("hello");
  });

  it("overwrites existing value", async () => {
    await db.setMetaValue("test_key", "first");
    await db.setMetaValue("test_key", "second");
    expect(await db.getMetaValue("test_key")).toBe("second");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/infrastructure/db.meta.test.ts
```

Expected: FAIL — `getMetaValue is not a function`

- [ ] **Step 3: Add `MetaRepository` to `src/repositories/interfaces.ts`**

Append at the end of the file (after line 102, after the closing `}` of `CompetencyRepository`):

```ts

export interface MetaRepository {
  getMetaValue(key: string): Promise<string | null>;
  setMetaValue(key: string, value: string): Promise<void>;
}
```

- [ ] **Step 4: Implement `MetaRepository` in `BuddyDb`**

In `src/infrastructure/db.ts`, change the class declaration line (line 35):

```ts
export class BuddyDb implements VocabRepository, ErrorRepository, SessionRepository, ProfileRepository, InterestRepository, CompetencyRepository, LearningRepository, MetaRepository {
```

Add the import for `MetaRepository` alongside the other repo imports (line 19):

```ts
import type {
  VocabRepository, ErrorRepository, SessionRepository, ProfileRepository,
  InterestRepository, CompetencyRepository, LearningRepository, MetaRepository,
} from "../repositories/interfaces.js";
```

Add the two methods just before the `close()` method (before line 274):

```ts
  async getMetaValue(key: string): Promise<string | null> {
    const rows = this.db.exec("SELECT value FROM _buddy_meta WHERE key = ?", [key]);
    return (rows[0]?.values[0]?.[0] as string | null) ?? null;
  }

  async setMetaValue(key: string, value: string): Promise<void> {
    this.db.run("INSERT OR REPLACE INTO _buddy_meta (key, value) VALUES (?, ?)", [key, value]);
    this.save();
  }

```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/infrastructure/db.meta.test.ts
```

Expected: PASS — 3 tests

- [ ] **Step 6: Commit**

```bash
git add src/repositories/interfaces.ts src/infrastructure/db.ts src/infrastructure/db.meta.test.ts
git commit -m "feat: add MetaRepository interface and implement in BuddyDb"
```

---

### Task 2: Update `DreamService` to record last dream date

**Files:**
- Modify: `src/services/DreamService.ts`
- Create: `src/services/DreamService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/DreamService.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { DreamService } from "./DreamService.js";
import type { SessionRepository, ErrorRepository, CompetencyRepository } from "../repositories/interfaces.js";
import type { MetaRepository } from "../repositories/interfaces.js";
import type { LLMProvider } from "../providers/interfaces.js";

function makeRepos() {
  const session: SessionRepository = {
    addChatMessage: vi.fn(),
    getChatHistory: vi.fn(),
    getSessionTranscript: vi.fn(),
    getTodaysMessages: vi.fn().mockResolvedValue([
      { role: "user", content: "Hola", created_at: "2026-06-03 10:00:00" },
    ]),
    getConversationState: vi.fn(),
    updateConversationState: vi.fn(),
  };
  const errors: ErrorRepository = {
    logError: vi.fn(),
    listErrors: vi.fn(),
    listRecentErrors: vi.fn().mockResolvedValue([]),
  };
  const competency: CompetencyRepository = {
    getCompetencyVector: vi.fn().mockResolvedValue({
      morph_obs: 0, morph_trials: 0, morph_successes: 0,
      idiom_obs: 0, idiom_trials: 0, idiom_successes: 0,
    }),
    updateCompetencyVector: vi.fn(),
    insertTurnAnnotation: vi.fn(),
    getRecentAnnotations: vi.fn().mockResolvedValue([]),
    insertProficiencyEvidence: vi.fn(),
    listProficiencyEvidence: vi.fn(),
    getTypicalVocabBand: vi.fn(),
  };
  const meta: MetaRepository = {
    getMetaValue: vi.fn().mockResolvedValue(null),
    setMetaValue: vi.fn().mockResolvedValue(undefined),
  };
  const provider: LLMProvider = {
    chat: vi.fn().mockResolvedValue({ content: "Updated memory content", toolCalls: [] }),
    complete: vi.fn(),
    completeJson: vi.fn(),
  };
  return { session, errors, competency, meta, provider };
}

describe("DreamService", () => {
  it("writes last_dream_date after a successful run", async () => {
    const { session, errors, competency, meta, provider } = makeRepos();
    const svc = new DreamService(session, errors, competency, provider, {
      timezone: "UTC",
      dreamMemoryPath: "/tmp/dream-test-memory.md",
      dreamSystemPrompt: "You are a memory updater.",
      morphologyCategories: new Set(),
      langId: "spanish",
    }, meta);

    await svc.run();

    expect(meta.setMetaValue).toHaveBeenCalledWith(
      "last_dream_date:spanish",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("does not write date when there are no messages", async () => {
    const { session, errors, competency, meta, provider } = makeRepos();
    (session.getTodaysMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const svc = new DreamService(session, errors, competency, provider, {
      timezone: "UTC",
      dreamMemoryPath: "/tmp/dream-test-memory.md",
      dreamSystemPrompt: "You are a memory updater.",
      morphologyCategories: new Set(),
      langId: "spanish",
    }, meta);

    await svc.run();

    expect(meta.setMetaValue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/DreamService.test.ts
```

Expected: FAIL — constructor signature mismatch / `setMetaValue` not called

- [ ] **Step 3: Update `DreamService`**

In `src/services/DreamService.ts`, update the imports (add `MetaRepository`):

```ts
import fs from "fs";
import path from "path";
import type { SessionRepository, ErrorRepository, CompetencyRepository, MetaRepository } from "../repositories/interfaces.js";
import type { LLMProvider } from "../providers/interfaces.js";
import { logger } from "../infrastructure/logger.js";
```

Update `DreamConfig` to include `langId`:

```ts
interface DreamConfig {
  timezone: string;
  dreamMemoryPath: string;
  dreamSystemPrompt: string;
  morphologyCategories: ReadonlySet<string>;
  langId: string;
}
```

Update the constructor to accept `MetaRepository`:

```ts
export class DreamService {
  constructor(
    private session: SessionRepository,
    private errors: ErrorRepository,
    private competency: CompetencyRepository,
    private provider: LLMProvider,
    private config: DreamConfig,
    private meta: MetaRepository,
  ) {}
```

In `run()`, after the early-return for no messages (after `return "Nothing to dream about today.";`) but before writing the file — actually, write the date just before the final return at the end of the `try` block. Replace the final return statements:

```ts
      fs.writeFileSync(this.config.dreamMemoryPath, updated, "utf8");
      log.info({ wordCount: updated.split(/\s+/).length }, 'memory updated');

      const refinementNotes = await this._runNightlyRefinement();

      const today = new Intl.DateTimeFormat("en-CA", { timeZone: this.config.timezone }).format(new Date());
      await this.meta.setMetaValue(`last_dream_date:${this.config.langId}`, today);

      if (refinementNotes.length > 0) {
        log.info({ refinementNotes }, 'refinement notes');
        const augmented = updated + "\n\n" + refinementNotes.join("\n");
        fs.writeFileSync(this.config.dreamMemoryPath, augmented, "utf8");
        return `Dream complete. Memory updated (${augmented.split(/\s+/).length} words). Refinement: ${refinementNotes.join("; ")}`;
      }

      return `Dream complete. Memory updated (${updated.split(/\s+/).length} words).`;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/services/DreamService.test.ts
```

Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/DreamService.ts src/services/DreamService.test.ts
git commit -m "feat: record last_dream_date in MetaRepository after successful dream run"
```

---

### Task 3: Wire new deps in `runtime.ts`

**Files:**
- Modify: `src/runtime.ts` (two `DreamService` constructor calls)

- [ ] **Step 1: Update `addLanguageConfig` in `runtime.ts`**

The `addLanguageConfig` method (around line 106) creates a `DreamService`. Add `langId` to config and pass `db` as meta:

```ts
    const dreamService = new DreamService(db, db, db, this.evaluatorProvider, {
      timezone: this.config.timezone,
      dreamMemoryPath,
      dreamSystemPrompt: lang.prompts.dream,
      morphologyCategories: new Set(lang.morphologyCategories),
      langId: lang.id,
    }, db);
```

- [ ] **Step 2: Update `addLanguage` in `runtime.ts`**

The `addLanguage` method (around line 137) also creates a `DreamService`. Apply the same change:

```ts
    const dreamService = new DreamService(db, db, db, this.evaluatorProvider, {
      timezone: this.config.timezone,
      dreamMemoryPath,
      dreamSystemPrompt: lang.prompts.dream,
      morphologyCategories: new Set(lang.morphologyCategories),
      langId: lang.id,
    }, db);
```

- [ ] **Step 3: Run full test suite to verify nothing broke**

```bash
npx vitest run
```

Expected: all existing tests pass (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/runtime.ts
git commit -m "feat: wire langId and MetaRepository into DreamService via runtime"
```

---

### Task 4: Add `runDreamIfOverdue` and call it on startup

**Files:**
- Modify: `src/app/startup.ts`
- Modify: `src/index.ts`
- Create: `src/app/startup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/startup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDreamIfOverdue } from "./startup.js";
import type { LanguageRuntime } from "../runtime.js";
import type { MetaRepository } from "../repositories/interfaces.js";
import type { Config } from "../infrastructure/config.js";

function makeConfig(timezone = "UTC"): Config {
  return {
    timezone,
    provider: "ollama",
    transport: "tui",
    telegramToken: "",
    telegramBotTokens: {},
    openrouterApiKey: "",
    chatModel: "",
    evaluatorModel: "",
    openrouterBaseUrl: "",
    ollamaBaseUrl: "",
    ollamaModel: "",
    ollamaApiKey: "",
    dbPath: "",
    dataDir: "",
    allowedUsers: new Set(),
    morningCron: "",
    eveningCron: "",
    telegramChatId: "",
    dreamCron: "",
    dreamMemoryPath: "",
  };
}

function makeRuntime(langId: string, dreamRun: () => Promise<string>): LanguageRuntime {
  return {
    lang: { id: langId } as any,
    dreamService: { run: dreamRun } as any,
  } as any;
}

describe("runDreamIfOverdue", () => {
  it("skips when last_dream_date is null (fresh install)", async () => {
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue(null),
      setMetaValue: vi.fn(),
    };
    const run = vi.fn();
    const rt = makeRuntime("spanish", run);

    await runDreamIfOverdue(makeConfig(), rt, meta);

    // give microtasks a chance to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(run).not.toHaveBeenCalled();
  });

  it("skips when last_dream_date is today", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue(today),
      setMetaValue: vi.fn(),
    };
    const run = vi.fn();
    const rt = makeRuntime("spanish", run);

    await runDreamIfOverdue(makeConfig(), rt, meta);

    await new Promise((r) => setTimeout(r, 10));
    expect(run).not.toHaveBeenCalled();
  });

  it("fires dream when last_dream_date is before today", async () => {
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue("2020-01-01"),
      setMetaValue: vi.fn(),
    };
    const run = vi.fn().mockResolvedValue("Dream complete.");
    const rt = makeRuntime("spanish", run);

    await runDreamIfOverdue(makeConfig(), rt, meta);

    await new Promise((r) => setTimeout(r, 10));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/startup.test.ts
```

Expected: FAIL — `runDreamIfOverdue is not exported`

- [ ] **Step 3: Add `runDreamIfOverdue` to `src/app/startup.ts`**

Add import for `MetaRepository` and `LanguageRuntime` at the top of the file, and add the function. The full updated `src/app/startup.ts`:

```ts
import type { Config } from "../infrastructure/config.js";
import { logger } from "../infrastructure/logger.js";
import type { LanguageRuntime, RuntimeManager } from "../runtime.js";
import type { MetaRepository } from "../repositories/interfaces.js";
import { startScheduler } from "../services/Scheduler.js";
import { TelegramTransport } from "../transport/TelegramTransport.js";
import type { Transport } from "../transport/Transport.js";

const log = logger.child({ ctx: "app" });

export async function runDreamIfOverdue(
  config: Config,
  rt: LanguageRuntime,
  meta: MetaRepository,
): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const lastDate = await meta.getMetaValue(`last_dream_date:${rt.lang.id}`);
  if (!lastDate || lastDate >= today) return;
  rt.dreamService.run().then(
    (result) => log.info({ result, lang: rt.lang.id }, "startup dream complete"),
    (err) => log.error({ err, lang: rt.lang.id }, "startup dream error"),
  );
}

export function startLanguageScheduler(config: Config, rt: LanguageRuntime, transport: Transport): void {
  const morningCronPrompt = process.env.MORNING_CRON_PROMPT ?? rt.lang.prompts.morning;
  const eveningCronPrompt = process.env.EVENING_CRON_PROMPT ?? rt.lang.prompts.evening;
  startScheduler(
    {
      morningCron: config.morningCron,
      eveningCron: config.eveningCron,
      dreamCron: config.dreamCron,
      timezone: config.timezone,
      telegramChatId: config.telegramChatId,
      morningCronPrompt,
      eveningCronPrompt,
    },
    (prompt) => rt.agentRunner.run(prompt, []),
    rt.dreamService,
    transport,
  );
}

export function createTelegramTransport(config: Config, language: string, token: string): TelegramTransport {
  return new TelegramTransport({
    telegramToken: token,
    allowedUsers: config.allowedUsers,
    language,
    botLabel: `${language}-telegram`,
  });
}

export function startTelegramTransport(manager: RuntimeManager, config: Config, language: string, transport: TelegramTransport): void {
  transport.onMessage((chatId, userId, text) => manager.handleMessage(language, Number(chatId), userId, text));
  transport.start({
    onStart: (info: { username: string }) => log.info({ username: info.username, language }, "bot started"),
    allowed_updates: ["message"],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/startup.test.ts
```

Expected: PASS — 3 tests

- [ ] **Step 5: Call `runDreamIfOverdue` from `src/index.ts`**

Add the import for `runDreamIfOverdue` at the top of `src/index.ts` (it's already imported from `./app/startup.js`):

```ts
import { createTelegramTransport, startLanguageScheduler, startTelegramTransport, runDreamIfOverdue } from "./app/startup.js";
```

In the `unified` transport path (after `startTelegramTransport`), add the startup dream check:

```ts
  if (config.transport === "unified") {
    for (const language of manager.languages().map((lang) => lang.id)) {
      const token = config.telegramBotTokens[language];
      if (!token) throw new Error(`Missing Telegram token for active language: ${language}`);
      const transport = createTelegramTransport(config, language, token);
      const rt = manager.runtime(language);
      startLanguageScheduler(config, rt, transport);
      startTelegramTransport(manager, config, language, transport);
      await runDreamIfOverdue(config, rt, rt.db);
    }

    return;
  }
```

In the `telegram` transport path (after `startLanguageScheduler`), add:

```ts
  if (config.transport === "telegram") {
    const rt = manager.runtime(defaultLanguage);
    startLanguageScheduler(config, rt, transport);
    await runDreamIfOverdue(config, rt, rt.db);
    transport.start({
      onStart: (info: { username: string }) => log.info({ username: info.username, language: defaultLanguage }, "bot started"),
      allowed_updates: ["message"],
    });
  } else {
    transport.start();
  }
```

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/app/startup.ts src/app/startup.test.ts src/index.ts
git commit -m "feat: run dream on startup if overdue"
```
