import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "../test/dbHelpers.js";
import { LearningHygieneService } from "./LearningHygieneService.js";

let handle: TestDbHandle;

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(() => {
  handle.cleanup();
});

describe("LearningHygieneService", () => {
  it("archives stale candidates and cools old active new items without evidence", async () => {
    const db = handle.db;
    db.db.run(
      `INSERT INTO learning_items (language, type, title, priority, status, stability, evidence_count, created_at, updated_at)
       VALUES ('spanish', 'phrase', 'stale candidate', 0.5, 'candidate', 'new', 0, datetime('now', '-8 days'), datetime('now', '-8 days'))`,
    );
    const candidateId = db.db.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;
    db.db.run(
      `INSERT INTO learning_items (language, type, title, priority, status, stability, evidence_count, created_at, updated_at)
       VALUES ('spanish', 'phrase', 'old active new', 0.5, 'active', 'new', 0, datetime('now', '-15 days'), datetime('now', '-15 days'))`,
    );
    const activeId = db.db.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;

    const result = await new LearningHygieneService(db).run();

    expect(result.archived).toBe(1);
    expect(result.cooledDown).toBe(1);
    const items = await db.listLearningItems("all", 10);
    expect(items.find((item) => item.id === candidateId)?.status).toBe("archived");
    expect(items.find((item) => item.id === activeId)?.status).toBe("cooling_down");
  });

  it("promotes candidates with evidence and masters items only after active production", async () => {
    const db = handle.db;
    const candidate = await db.addLearningItem({ type: "phrase", title: "estoy cansado", status: "candidate", priority: 0.6 });
    expect(candidate).not.toBeNull();
    await db.recordLearningItemEvidence({ learning_item_id: candidate!, skill: "passive", event: "recognized", score_delta: 0.2, confidence: 1 });

    const stable = await db.addLearningItem({ type: "phrase", title: "fui al gimnasio", priority: 0.8 });
    expect(stable).not.toBeNull();
    await db.recordLearningItemEvidence({ learning_item_id: stable!, skill: "active", event: "spontaneous_production", score_delta: 0.9, confidence: 1 });
    await db.recordLearningItemEvidence({ learning_item_id: stable!, skill: "passive", event: "recognized", score_delta: 0.8, confidence: 1 });

    const result = await new LearningHygieneService(db).run();

    expect(result.promoted).toBeGreaterThanOrEqual(1);
    expect(result.mastered).toBeGreaterThanOrEqual(1);
    const items = await db.listLearningItems("all", 20);
    expect(items.find((item) => item.id === candidate)?.status).toBe("active");
    expect(items.find((item) => item.id === stable)?.status).toBe("mastered");
  });
});
