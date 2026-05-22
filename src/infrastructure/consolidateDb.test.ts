import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "./db.js";
import { consolidateMiguelitoDatabases } from "./consolidateDb.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import { PolishLanguage } from "../languages/polish/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-consolidate-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("consolidateMiguelitoDatabases", () => {
  it("merges language DBs into one operational DB with language-scoped rows and an audit copy of every source row", async () => {
    const spanishPath = path.join(tmpDir, "buddy-spanish.db");
    const polishPath = path.join(tmpDir, "buddy-polish.db");
    const sharedPath = path.join(tmpDir, "buddy-shared.db");
    const targetPath = path.join(tmpDir, "buddy.db");

    const spanish = await BuddyDb.open(spanishPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
    await spanish.addVocab("gato", "el gato", "gato");
    await spanish.logError("yo es", "yo soy", "verb_conjugation", "ser");
    const spanishSession = await spanish.getConversationState();
    await spanish.addChatMessage(123, "user", "Hola", spanishSession.session.session_id);
    await spanish.setProfile({ name: "Spanish profile" });
    await spanish.addInterest("Music", "spanish", 0.7);
    spanish.close();

    const polish = await BuddyDb.open(polishPath, "polish", PolishLanguage.errorCategories, PolishLanguage.morphologyCategories);
    await polish.addVocab("kot", "ten kot", "kot");
    const polishSession = await polish.getConversationState();
    await polish.addChatMessage(123, "user", "Cześć", polishSession.session.session_id);
    await polish.addInterest("Music", "polish", 0.9);
    await polish.addInterest("Trains", "polish", 0.8);
    polish.close();

    const shared = await BuddyDb.open(sharedPath, "shared", [], []);
    await shared.setProfile({ name: "Shared profile", goal: "speak more" });
    shared.close();

    const result = await consolidateMiguelitoDatabases({ dataDir: tmpDir, targetPath });

    expect(result.sources.map((s) => path.basename(s.path)).sort()).toEqual(["buddy-polish.db", "buddy-shared.db", "buddy-spanish.db"]);
    expect(result.targetPath).toBe(targetPath);

    const spanUnified = await BuddyDb.open(targetPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
    const polUnified = spanUnified.withLanguage("polish", PolishLanguage.errorCategories, PolishLanguage.morphologyCategories);

    expect((await spanUnified.listVocab("all", 10)).map((r) => r.chunk_l2)).toContain("gato");
    expect((await polUnified.listVocab("all", 10)).map((r) => r.chunk_l2)).toContain("kot");
    expect((await spanUnified.getChatHistory(123, 10)).map((m) => m.content)).toEqual(["Hola"]);
    expect((await polUnified.getChatHistory(123, 10)).map((m) => m.content)).toEqual(["Cześć"]);
    expect(await spanUnified.listInterests(10)).toEqual(expect.arrayContaining(["Music", "Trains"]));

    const auditCount = spanUnified.db.exec("SELECT COUNT(*) FROM _migration_rows")[0].values[0][0];
    const sourceRowCount = result.sources.reduce((sum, source) => sum + Object.values(source.tableCounts).reduce((a, b) => a + b, 0), 0);
    expect(auditCount).toBe(sourceRowCount);
    expect(spanUnified.db.exec("SELECT COUNT(*) FROM _migration_id_map WHERE table_name = 'vocabulary_items'")[0].values[0][0]).toBe(2);

    spanUnified.close();
  });
});
