import { describe, it, expect, vi } from "vitest";
import { runDreamIfOverdue, runNightlyMaintenanceIfOverdue } from "./startup.js";
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

function makeRuntime(
  langId: string,
  dreamRun: () => Promise<string>,
  todaysMessages: unknown[] = [],
  dbOverrides: Record<string, unknown> = {},
): LanguageRuntime {
  return {
    lang: { id: langId } as any,
    dreamService: { run: dreamRun } as any,
    db: { getTodaysMessages: vi.fn().mockResolvedValue(todaysMessages), ...dbOverrides } as any,
  } as any;
}

describe("runDreamIfOverdue", () => {
  it("skips when last_dream_date is null and no messages (fresh install)", async () => {
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue(null),
      setMetaValue: vi.fn(),
    };
    const run = vi.fn();
    const rt = makeRuntime("spanish", run, []);

    await runDreamIfOverdue(makeConfig(), rt, meta);

    await new Promise((r) => setTimeout(r, 10));
    expect(run).not.toHaveBeenCalled();
  });

  it("fires dream when last_dream_date is null but messages exist", async () => {
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue(null),
      setMetaValue: vi.fn(),
    };
    const run = vi.fn().mockResolvedValue("Dream complete.");
    const rt = makeRuntime("spanish", run, [{ role: "user", content: "Hola" }]);

    await runDreamIfOverdue(makeConfig(), rt, meta);

    await new Promise((r) => setTimeout(r, 10));
    expect(run).toHaveBeenCalledTimes(1);
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

describe("runNightlyMaintenanceIfOverdue", () => {
  it("runs learning-item and error dedupe once per local date", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue("2020-01-01"),
      setMetaValue: vi.fn(),
    };
    const deduplicateLearningItems = vi.fn().mockResolvedValue(2);
    const deduplicateErrors = vi.fn().mockResolvedValue(3);
    const rt = makeRuntime("spanish", vi.fn(), [], { deduplicateLearningItems, deduplicateErrors });

    const result = await runNightlyMaintenanceIfOverdue(makeConfig(), rt, meta);

    expect(result).toEqual({ learningItemsMerged: 2, errorsMerged: 3 });
    expect(deduplicateLearningItems).toHaveBeenCalledTimes(1);
    expect(deduplicateErrors).toHaveBeenCalledTimes(1);
    expect(meta.setMetaValue).toHaveBeenCalledWith("last_nightly_maintenance_date:spanish", today);
  });

  it("skips when nightly maintenance already ran today", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue(today),
      setMetaValue: vi.fn(),
    };
    const deduplicateLearningItems = vi.fn();
    const deduplicateErrors = vi.fn();
    const rt = makeRuntime("spanish", vi.fn(), [], { deduplicateLearningItems, deduplicateErrors });

    const result = await runNightlyMaintenanceIfOverdue(makeConfig(), rt, meta);

    expect(result).toEqual({ learningItemsMerged: 0, errorsMerged: 0 });
    expect(deduplicateLearningItems).not.toHaveBeenCalled();
    expect(deduplicateErrors).not.toHaveBeenCalled();
    expect(meta.setMetaValue).not.toHaveBeenCalled();
  });
});
