import fs from "fs";
import os from "os";
import path from "path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { BuddyDb } from "./infrastructure/db.js";
import { SpanishLanguage } from "./languages/spanish/index.js";

const FORBIDDEN_TABLES = ["vocabulary_items", "vocabulary_candidates", "vocab_review_attempts"];
const FORBIDDEN_CODE_PATTERNS = [
  /VocabRepository/,
  /SqlVocabRepository/,
  /addVocab\b/,
  /listVocab\b/,
  /dueVocab\b/,
  /scoreVocab\b/,
  /promoteVocab/,
  /vocab_review_attempts/,
  /vocabulary_items/,
  /vocabulary_candidates/,
];

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("legacy vocabulary removal", () => {
  it("does not create legacy vocabulary/SRS tables for new databases", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-no-vocab-schema-"));
    const dbPath = path.join(tmpDir, "test.db");
    try {
      const db = await BuddyDb.open(dbPath, SpanishLanguage.id, SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
      const tables = db.db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.flat().map(String) ?? [];
      for (const table of FORBIDDEN_TABLES) expect(tables).not.toContain(table);
      db.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("drops legacy vocabulary/SRS tables when opening an existing database", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-drop-vocab-schema-"));
    const dbPath = path.join(tmpDir, "test.db");
    try {
      const SQL = await initSqlJs();
      const legacy = new SQL.Database();
      legacy.run("CREATE TABLE vocabulary_items (id INTEGER PRIMARY KEY, chunk_l2 TEXT)");
      legacy.run("CREATE TABLE vocabulary_candidates (id INTEGER PRIMARY KEY, chunk_l2 TEXT)");
      legacy.run("CREATE TABLE vocab_review_attempts (id INTEGER PRIMARY KEY, word TEXT)");
      fs.writeFileSync(dbPath, Buffer.from(legacy.export()));
      legacy.close();

      const db = await BuddyDb.open(dbPath, SpanishLanguage.id, SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
      const tables = db.db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.flat().map(String) ?? [];
      for (const table of FORBIDDEN_TABLES) expect(tables).not.toContain(table);
      db.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps legacy vocabulary repository APIs out of production source", () => {
    const srcDir = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    for (const file of listSourceFiles(srcDir)) {
      if (file.endsWith("legacyVocabRemoval.test.ts") || file.includes(".test.") || file.endsWith("migrations.ts")) continue;
      const rel = path.relative(process.cwd(), file);
      const text = fs.readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_CODE_PATTERNS) {
        if (pattern.test(text)) offenders.push(`${rel}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
