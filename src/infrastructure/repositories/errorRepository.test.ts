import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../db.js";
import { SpanishLanguage } from "../../languages/spanish/index.js";

let db: BuddyDb;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-errors-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"), "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("error log deduplication", () => {
  it("archives fuzzy repeated correction rows with minor wording differences", async () => {
    const first = await db.logError("No hay de que", "No hay de qué", "accent", "missing accent");
    const second = await db.logError("no hay de qué", "No hay de qué", "accent", "same correction with accent");
    const third = await db.logError("Es qué", "Es que", "accent", "same category but different target");

    const merged = await db.deduplicateFuzzyErrors();

    expect(merged).toBe(1);
    const active = await db.listErrors("all", 10);
    expect(new Set(active.map((e) => e.id))).toEqual(new Set([first, third]));
    const keeper = active.find((e) => e.id === first)!;
    expect(keeper.note).toContain("missing accent");
    expect(keeper.note).toContain("same correction with accent");
  });

  it("archives repeated correction rows by normalized learner text, correction, and category", async () => {
    const first = await db.logError("Yo entreno en gym", "Entreno en el gimnasio", "word_choice", "missing article");
    const second = await db.logError("  yo entreno en GYM  ", "entreno en el gimnasio", "word_choice", "duplicate wording");
    const third = await db.logError("Yo entreno en gym", "Entreno en el gimnasio", "preposition", "different category remains separate");

    const merged = await db.deduplicateErrors();

    expect(merged).toBe(1);
    const active = await db.listErrors("all", 10);
    expect(new Set(active.map((e) => e.id))).toEqual(new Set([first, third]));
    const keeper = active.find((e) => e.id === first)!;
    expect(keeper.note).toContain("missing article");
    expect(keeper.note).toContain("duplicate wording");

    const rows = db.db.exec("SELECT id, status FROM error_log ORDER BY id ASC")[0].values;
    expect(rows).toEqual([[first, "active"], [second, "archived"], [second + 1, "active"]]);
  });
});
