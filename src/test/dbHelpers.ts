import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import { PolishLanguage } from "../languages/polish/index.js";

export interface TestDbHandle {
  db: BuddyDb;
  dbPath: string;
  tmpDir: string;
  cleanup(): void;
}

export async function createTestDb(language: LanguageConfig = SpanishLanguage): Promise<TestDbHandle> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const db = await BuddyDb.open(dbPath, language.id, language.errorCategories, language.morphologyCategories);
  return {
    db,
    dbPath,
    tmpDir,
    cleanup() {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

export interface MultilangTestDbHandle {
  dbSpanish: BuddyDb;
  dbPolish: BuddyDb;
  dbPath: string;
  tmpDir: string;
  cleanup(): void;
}

export async function createMultilangTestDb(): Promise<MultilangTestDbHandle> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-multilang-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const dbSpanish = await BuddyDb.open(dbPath, SpanishLanguage.id, SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
  const dbPolish = await BuddyDb.open(dbPath, PolishLanguage.id, PolishLanguage.errorCategories, PolishLanguage.morphologyCategories);
  return {
    dbSpanish,
    dbPolish,
    dbPath,
    tmpDir,
    cleanup() {
      dbSpanish.close();
      dbPolish.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
