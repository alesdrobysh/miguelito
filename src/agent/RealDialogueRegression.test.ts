import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import type { LLMProvider, ChatMessage, ChatResult, ChatOptions } from "../providers/interfaces.js";
import { PostTurnProcessor } from "./PostTurnProcessor.js";

const dialogs = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "real-dialogs.json"), "utf8"));

class FixtureProvider implements LLMProvider {
  constructor(private payload: unknown) {}
  async chat(): Promise<ChatResult> { throw new Error("chat unused"); }
  async complete(): Promise<string> { return JSON.stringify(this.payload); }
  async completeJson<T>(_system: string | null, _user: string, opts?: ChatOptions): Promise<T> {
    expect(opts?.temperature).toBe(0);
    return this.payload as T;
  }
}

let db: BuddyDb;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-real-dialog-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"), "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
  await db.addVocab("echar de menos", "Te echo de menos", "echar");
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("real dialogue regressions", () => {
  for (const dialog of dialogs as any[]) {
    it(`keeps deterministic post-turn behavior for ${dialog.name}`, async () => {
      const processor = new PostTurnProcessor({ provider: new FixtureProvider(dialog.evaluation), vocab: db, errors: db, competency: db, session: db, lang: SpanishLanguage });
      await processor.process({ userMessage: dialog.userMessage, assistantText: dialog.assistantText, chatHistory: dialog.history as ChatMessage[] });

      const anns = await db.getRecentAnnotations(10);
      expect(anns.length).toBeGreaterThan(0);
      const expectedErrors = dialog.evaluation.errors ?? [];
      const actualErrors = await db.listErrors("all", 20);
      for (const expected of expectedErrors) {
        expect(actualErrors.some((e) => e.user_text === expected.user_text && e.correct_form === expected.correct)).toBe(true);
      }
      const expectedVocab = dialog.evaluation.vocabulary ?? [];
      const actualCandidates = await db.listVocabCandidates("all", 20);
      const actualActive = await db.listVocab("all", 20);
      const seenChunks = [...actualCandidates.map((v) => v.chunk_l2), ...actualActive.map((v) => v.chunk_l2)];
      for (const expected of expectedVocab) {
        expect(seenChunks).toContain(expected.word);
      }
    });
  }
});
