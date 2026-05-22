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
  it("does not inject stale interests when the current message does not mention them", async () => {
    for (const i of ["programming", "hiking", "karkonosze", "cooking", "music"]) {
      await db.addInterest(i, "conversation", 0.7);
    }

    const builder = new PromptBuilder(
      { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db },
      SpanishLanguage,
    );
    const prompt = await builder.build("Hoy estoy pensando en el tiempo y en mis planes.");

    expect(prompt).not.toContain("\n\n## Lo que sé de esta persona\n");
    for (const stored of ["programming", "hiking", "karkonosze", "cooking", "music"]) {
      expect(prompt.toLowerCase()).not.toContain(stored);
    }
  });

  it("injects only interests that are already relevant to the current message", async () => {
    for (const i of ["books", "music", "cooking"]) {
      await db.addInterest(i, "conversation", 0.7);
    }

    const builder = new PromptBuilder(
      { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db },
      SpanishLanguage,
    );
    const prompt = await builder.build("Estoy leyendo books antes de dormir.");

    expect(prompt).toContain("Lo que sé de esta persona");
    expect(prompt).toContain("books");
    expect(prompt).not.toContain("music");
    expect(prompt).not.toContain("cooking");
    expect(prompt).toContain("optional background");
    expect(prompt).toContain("Do not keep returning to the same interest");
  });

  it("uses the renamed section header", async () => {
    await db.addInterest("programming", "conversation", 0.7);

    const builder = new PromptBuilder(
      { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db },
      SpanishLanguage,
    );
    const prompt = await builder.build("programming");

    expect(prompt).toContain("Lo que sé de esta persona");
    expect(prompt).not.toContain("## User Interests");
  });
});


describe("PromptBuilder vocabulary target injection", () => {
  it("separates receptive words for bot integration from productive words for learner elicitation", async () => {
    await db.addVocab("posponer la reunión", "ctx", "posponer");
    await db.addVocab("echar de menos", "ctx", "echar");
    await db.scoreVocab("posponer la reunión", 3, "receptive");
    await db.scoreVocab("echar de menos", 3, "productive");

    const builder = new PromptBuilder(
      { vocab: db, errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db },
      SpanishLanguage,
    );
    const prompt = await builder.build();

    expect(prompt).toContain("Vocabulario receptivo");
    expect(prompt).toContain("Vocabulario productivo");
    expect(prompt).toContain("Integra tú estas expresiones");
    expect(prompt).toContain("Crea una necesidad comunicativa");
    expect(prompt).toContain("posponer la reunión");
    expect(prompt).toContain("echar de menos");
  });
});
