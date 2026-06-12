import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../db.js";
import { SpanishLanguage } from "../../languages/spanish/index.js";

let db: BuddyDb;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-learning-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"), "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("learning item deduplication and scheduling", () => {
  it("deduplicates vocabulary-like items across word/phrase evaluator variants", async () => {
    const first = await db.addLearningItem({ type: "word", title: "bajada", priority: 0.6, prompt_l2: "bajada" });
    const second = await db.addLearningItem({ type: "phrase", title: "Bajada", priority: 0.9, prompt_l2: "la bajada de una montaña" });

    expect(second).toBe(first);
    const items = await db.listLearningItems("all", 10);
    expect(items).toHaveLength(1);
    expect(items[0].priority).toBe(0.9);
    expect(items[0].status).toBe("active");
  });

  it("scheduled dedupe merges existing duplicate rows and preserves evidence", async () => {
    db.db.run(
      `INSERT INTO learning_items (language, type, title, priority, status, created_at, updated_at)
       VALUES ('spanish', 'word', 'cajón', 0.6, 'active', datetime('now'), datetime('now'))`,
    );
    const first = db.db.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;
    db.db.run(
      `INSERT INTO learning_items (language, type, title, priority, status, active_score, evidence_count, created_at, updated_at)
       VALUES ('spanish', 'phrase', 'cajon', 0.9, 'active', 0.3, 1, datetime('now'), datetime('now'))`,
    );
    const second = db.db.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;
    await db.recordLearningItemEvidence({ learning_item_id: second, skill: "active", event: "spontaneous_production", score_delta: 0.2, confidence: 1 });

    const merged = await db.deduplicateLearningItems();

    expect(merged).toBe(1);
    const active = (await db.listLearningItems("all", 10)).filter((item) => item.status !== "archived");
    expect(active).toHaveLength(1);
    const evidence = await db.listLearningItemEvidence(active[0].id, 10);
    expect(evidence).toHaveLength(1);
    expect([first, second]).toContain(active[0].id);
  });

  it("schedules low-score evidence for next-day reactivation", async () => {
    const id = await db.addLearningItem({ type: "word", title: "interruptor", priority: 0.8 });
    expect(id).not.toBeNull();
    await db.recordLearningItemEvidence({ learning_item_id: id!, skill: "passive", event: "recognized", score_delta: 0.1, confidence: 1 });

    const item = (await db.listLearningItems("all", 10))[0];
    const due = new Date(item.next_reactivation_at!).getTime();
    const hours = (due - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(20);
    expect(hours).toBeLessThanOrEqual(25);
  });
});
