import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import { VocabularyReviewPlanner } from "./VocabularyReviewPlanner.js";

let db: BuddyDb;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-review-plan-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"), "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("VocabularyReviewPlanner", () => {
  it("selects scheduled productive and receptive reviews deterministically in code", async () => {
    await db.addVocab("echar de menos", "ctx", "echar");
    await db.addVocab("posponer la reunión", "ctx", "posponer");
    await db.addVocab("me cuesta + [inf]", "ctx", "costar");
    await db.scoreVocab("posponer la reunión", 3, "productive");

    const plan = await new VocabularyReviewPlanner(db).select();

    expect(plan.productiveWords).toEqual(["echar de menos"]);
    expect(plan.receptiveWords).toEqual(["posponer la reunión", "me cuesta + [inf]"]);
    expect(plan.receptiveWords).not.toContain(plan.productiveWords[0]);
  });
});
