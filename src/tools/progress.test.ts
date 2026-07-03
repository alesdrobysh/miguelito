import { describe, it, expect } from "vitest";
import { createProgressTools } from "./progress.js";
import { SpanishLanguage } from "../languages/spanish/index.js";

describe("miguelito_progress_summary", () => {
  it("shows concrete rusty examples sorted by reactivation pressure", async () => {
    const due = [
      { id: 2, title: "me da igual", reactivation_pressure: "medium", priority: 0.6 },
      { id: 1, title: "por vs para", reactivation_pressure: "high", priority: 0.5 },
      { id: 3, title: "algo", reactivation_pressure: "low", priority: 1 },
    ];
    const ctx = {
      learning: {
        listLearningItems: async () => [],
        listDueLearningItems: async () => due,
        getLearningHygieneSnapshot: async () => ({
          backlog_status: "healthy",
          active_without_evidence: 0,
          candidate_without_evidence: 0,
          stale_new_items: 0,
          due_high_pressure: 1,
          reintroduced_without_production: 0,
          suspicious_items: 0,
        }),
      },
      errors: { listErrors: async () => [] },
      competency: { getCompetencyVector: async () => { throw new Error("no vector"); } },
    } as any;

    const [tool] = createProgressTools(ctx, SpanishLanguage);
    const result = await tool.execute();

    expect(result.hygiene.rusty_examples).toEqual(["por vs para", "me da igual", "algo"]);
  });
});
