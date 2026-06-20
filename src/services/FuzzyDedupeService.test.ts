import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import { FuzzyDedupeService } from "./FuzzyDedupeService.js";
import type { LLMProvider } from "../providers/interfaces.js";

let db: BuddyDb;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-fuzzy-dedupe-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"), "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function providerWithDecision(decision: unknown): LLMProvider {
  return {
    chat: vi.fn(),
    complete: vi.fn(),
    completeJson: vi.fn().mockResolvedValue(decision),
  } as unknown as LLMProvider;
}

describe("FuzzyDedupeService", () => {
  it("asks the evaluator to classify fuzzy candidates with structured JSON", async () => {
    await db.addLearningItem({ type: "correction", title: "aplicaciónes → aplicaciones", prompt_l2: "aplicaciónes" });
    await db.addLearningItem({ type: "correction", title: "aplicaciones (plural sin tilde)", prompt_l2: "aplicaciones" });
    const provider = providerWithDecision({
      decisions: [{ itemAId: 1, itemBId: 2, decision: "merge", keeperId: 1, confidence: 0.96, reason: "same pluralization target" }],
    });
    const service = new FuzzyDedupeService(db, provider);

    const result = await service.adjudicate({ limit: 10 });

    expect(provider.completeJson).toHaveBeenCalledWith(
      expect.stringContaining("deduplicate Spanish learning items"),
      expect.stringContaining("aplicaciónes"),
      expect.objectContaining({ temperature: 0, structured: true }),
    );
    expect(result.decisions).toEqual([
      expect.objectContaining({ decision: "merge", keeperId: 1, confidence: 0.96 }),
    ]);
  });

  it("applies only high-confidence merge decisions and preserves evidence", async () => {
    const first = await db.addLearningItem({ type: "correction", title: "¿Funcionas? addressed as tú", prompt_l2: "¿Funcionas?", priority: 0.5 });
    const second = await db.addLearningItem({ type: "correction", title: "¿Funcionas? → ¿Funciona?", prompt_l2: "¿Funcionas?", priority: 0.9 });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await db.recordLearningItemEvidence({ learning_item_id: second!, skill: "active", event: "spontaneous_production", score_delta: 0.2, confidence: 1 });
    const provider = providerWithDecision({
      decisions: [{ itemAId: first, itemBId: second, decision: "merge", keeperId: second, confidence: 0.94, reason: "same correction" }],
    });
    const service = new FuzzyDedupeService(db, provider);

    const result = await service.adjudicateAndApply({ limit: 10, minConfidence: 0.9 });

    expect(result.appliedMerges).toBe(1);
    const all = await db.listLearningItems("all", 10);
    const keeper = all.find((item) => item.id === second)!;
    const loser = all.find((item) => item.id === first)!;
    expect(keeper.status).toBe("active");
    expect(loser.status).toBe("archived");
    expect(await db.listLearningItemEvidence(second!, 10)).toHaveLength(1);
  });

  it("does not apply low-confidence or related decisions", async () => {
    const first = await db.addLearningItem({ type: "phrase", title: "despistado", prompt_l2: "Qué es despistado?" });
    const second = await db.addLearningItem({ type: "phrase", title: "ser despistado", prompt_l2: "Soy muy despistado" });
    const provider = providerWithDecision({
      decisions: [{ itemAId: first, itemBId: second, decision: "related", confidence: 0.98, reason: "word vs construction" }],
    });
    const service = new FuzzyDedupeService(db, provider);

    const result = await service.adjudicateAndApply({ limit: 10, minConfidence: 0.9 });

    expect(result.appliedMerges).toBe(0);
    expect((await db.listLearningItems("all", 10)).filter((item) => item.status !== "archived")).toHaveLength(2);
  });
});
