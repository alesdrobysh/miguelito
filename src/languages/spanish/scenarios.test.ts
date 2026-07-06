import { describe, it, expect } from "vitest";
import { SpanishScenarios } from "./scenarios.js";

describe("SpanishScenarios", () => {
  it("keeps the scenario catalog tiny, bounded, and learner-facing", () => {
    const ids = new Set<string>();

    expect(SpanishScenarios).toHaveLength(10);
    expect(SpanishScenarios.map((s) => s.id)).toEqual(expect.arrayContaining([
      "pedir_comida",
      "aeropuerto",
      "entrevista_trabajo",
      "small_talk",
      "debate_suave",
      "foto_descripcion",
    ]));
    for (const scenario of SpanishScenarios) {
      expect(scenario.id).toMatch(/^[a-z0-9_]+$/);
      expect(ids.has(scenario.id)).toBe(false);
      ids.add(scenario.id);
      expect(scenario.title).toBeTruthy();
      expect(scenario.setup_l1).toBeTruthy();
      expect(scenario.opening_line_l2).toBeTruthy();
      expect(scenario.maxTurns).toBeGreaterThanOrEqual(4);
      expect(scenario.maxTurns).toBeLessThanOrEqual(8);
      expect(`${scenario.title} ${scenario.setup_l1} ${scenario.opening_line_l2}`).not.toMatch(/learning item|state machine|CRM|dashboard/i);
    }
  });
});
