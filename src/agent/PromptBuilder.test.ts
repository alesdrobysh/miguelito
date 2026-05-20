import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { PromptBuilder } from "./PromptBuilder.js";
import { SpanishLanguage } from "../languages/spanish/index.js";

let db: BuddyDb;
let tmpDir: string;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-pb-test-"));
  db = await BuddyDb.open(
    path.join(tmpDir, "test.db"),
    "spanish",
    SpanishLanguage.errorCategories,
    SpanishLanguage.morphologyCategories,
  );
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PromptBuilder interest injection", () => {
  it("injects at most 2 interests even when more are stored", async () => {
    for (const i of ["programming", "hiking", "karkonosze", "cooking", "music"]) {
      await db.addInterest(i, "conversation", 0.7);
    }

    const builder = new PromptBuilder(
      { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db },
      SpanishLanguage,
    );
    const prompt = await builder.build();

    const stored = ["programming", "hiking", "karkonosze", "cooking", "music"];
    const found = stored.filter((i) => prompt.toLowerCase().includes(i));
    expect(found.length).toBeLessThanOrEqual(2);
  });

  it("uses the renamed section header", async () => {
    await db.addInterest("programming", "conversation", 0.7);

    const builder = new PromptBuilder(
      { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db },
      SpanishLanguage,
    );
    const prompt = await builder.build();

    expect(prompt).toContain("Lo que sé de esta persona");
    expect(prompt).not.toContain("## User Interests");
  });
});
