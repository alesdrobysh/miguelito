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
  it("blocks low-priority lexical items when the active backlog is blocked", async () => {
    for (let i = 0; i < 51; i++) {
      db.db.run(
        `INSERT INTO learning_items (language, type, title, priority, status, stability, evidence_count, created_at, updated_at)
         VALUES ('spanish', 'phrase', ?, 0.5, 'active', 'new', 0, datetime('now', '-15 days'), datetime('now', '-15 days'))`,
        [`crowded ${i}`],
      );
    }

    const id = await db.addLearningItem({ type: "phrase", title: "farmer's walk", priority: 0.6, source_type: "conversation" });

    expect(id).toBeNull();
    expect((await db.listLearningItems("all", 100)).some((row) => row.title === "farmer's walk")).toBe(false);
    const snapshot = await db.getLearningHygieneSnapshot();
    expect(snapshot.backlog_status).toBe("blocked");
    expect(snapshot.active_without_evidence).toBe(51);
  });

  it("keeps high-priority corrections active but ignores suspicious one-token correction noise", async () => {
    const useful = await db.addLearningItem({ type: "correction", title: "partida → partido", prompt_l2: "partida", priority: 0.9, source_type: "correction" });
    const noisy = await db.addLearningItem({ type: "correction", title: "Auw → Australia", prompt_l2: "Auw", priority: 0.9, source_type: "correction" });

    const items = await db.listLearningItems("all", 20);
    expect(items.find((item) => item.id === useful)?.status).toBe("active");
    expect(items.find((item) => item.id === noisy)?.status).toBe("ignored");
  });

  it("records assistant reintroduction evidence instead of silently advancing due items", async () => {
    const id = await db.addLearningItem({ type: "correction", title: "partida → partido", priority: 0.9 });
    expect(id).not.toBeNull();

    await db.recordLearningItemEvidence({ learning_item_id: id!, skill: "reactivation", event: "assistant_reintroduced", score_delta: 0.2, confidence: 1 });

    const item = (await db.listLearningItems("all", 10)).find((row) => row.id === id)!;
    expect(item.last_reactivated_at).not.toBeNull();
    expect(item.passive_score).toBeCloseTo(0.05, 3);
    expect(item.active_score).toBe(0);
  });

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

  it("finds fuzzy duplicate candidates without merging different objectives that share an example", async () => {
    const pluralTypo = await db.addLearningItem({
      type: "correction",
      title: "aplicaciónes → aplicaciones",
      priority: 0.8,
      prompt_l2: "aplicaciónes",
      explanation_l1: "la palabra aplicación pierde la tilde al pluralizarse: aplicaciones",
    });
    const pluralRule = await db.addLearningItem({
      type: "correction",
      title: "aplicaciones (plural sin tilde)",
      priority: 0.7,
      prompt_l2: "aplicaciones",
      explanation_l1: "when pluralizing nouns that end in -ón, the accent mark is dropped: aplicación → aplicaciones",
    });
    const idiom = await db.addLearningItem({
      type: "phrase",
      title: "ir sobre ruedas",
      prompt_l2: "Me alegra que todo vaya sobre ruedas.",
      explanation_l1: "It means to go smoothly.",
    });
    const grammar = await db.addLearningItem({
      type: "grammar_point",
      title: "subjunctive with alegrarse de que",
      prompt_l2: "Me alegra que todo vaya sobre ruedas.",
      explanation_l1: "After me alegra que, use the subjunctive.",
    });

    const candidates = await db.findFuzzyLearningItemDuplicateCandidates({ limit: 20 });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemA: expect.objectContaining({ id: pluralTypo }),
        itemB: expect.objectContaining({ id: pluralRule }),
        reason: expect.stringContaining("prompt"),
      }),
    ]));
    expect(candidates.some((c) => {
      const ids = [c.itemA.id, c.itemB.id].sort((a, b) => a - b);
      return ids[0] === idiom && ids[1] === grammar;
    })).toBe(false);
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
