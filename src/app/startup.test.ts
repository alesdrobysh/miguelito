import { describe, it, expect, vi } from "vitest";
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
