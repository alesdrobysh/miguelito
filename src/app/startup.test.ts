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
    evaluatorProvider: dbOverrides.evaluatorProvider,
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
  it("runs exact and fuzzy dedupe for learning items and errors once per local date", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
    const meta: MetaRepository = {
      getMetaValue: vi.fn().mockResolvedValue("2020-01-01"),
      setMetaValue: vi.fn(),
    };
    const deduplicateLearningItems = vi.fn().mockResolvedValue(2);
    const deduplicateErrors = vi.fn().mockResolvedValue(3);
    const deduplicateFuzzyErrors = vi.fn().mockResolvedValue(1);
    const findFuzzyLearningItemDuplicateCandidates = vi.fn().mockResolvedValue([
      { itemA: { id: 1, title: "a", type: "correction" }, itemB: { id: 2, title: "b", type: "correction" }, score: 1, promptSimilarity: 1, titleSimilarity: 0.8, tokenSimilarity: 0.6, reason: "prompt similarity 1.00" },
    ]);
    const applyFuzzyLearningItemMerge = vi.fn().mockResolvedValue({ keeperId: 1, archivedId: 2 });
    const evaluatorProvider = {
      completeJson: vi.fn().mockResolvedValue({ decisions: [{ itemAId: 1, itemBId: 2, decision: "merge", keeperId: 1, confidence: 0.95, reason: "same target" }] }),
    };
    const rt = makeRuntime("spanish", vi.fn(), [], { deduplicateLearningItems, deduplicateErrors, deduplicateFuzzyErrors, findFuzzyLearningItemDuplicateCandidates, applyFuzzyLearningItemMerge, evaluatorProvider });

    const result = await runNightlyMaintenanceIfOverdue(makeConfig(), rt, meta);

    expect(result).toEqual({ learningItemsMerged: 2, errorsMerged: 3, fuzzyLearningCandidates: 1, fuzzyLearningItemsMerged: 1, fuzzyErrorsMerged: 1 });
    expect(deduplicateLearningItems).toHaveBeenCalledTimes(1);
    expect(deduplicateErrors).toHaveBeenCalledTimes(1);
    expect(deduplicateFuzzyErrors).toHaveBeenCalledTimes(1);
    expect(evaluatorProvider.completeJson).toHaveBeenCalledTimes(1);
    expect(applyFuzzyLearningItemMerge).toHaveBeenCalledTimes(1);
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

    expect(result).toEqual({ learningItemsMerged: 0, errorsMerged: 0, fuzzyLearningCandidates: 0, fuzzyLearningItemsMerged: 0, fuzzyErrorsMerged: 0 });
    expect(deduplicateLearningItems).not.toHaveBeenCalled();
    expect(deduplicateErrors).not.toHaveBeenCalled();
    expect(meta.setMetaValue).not.toHaveBeenCalled();
  });
});
