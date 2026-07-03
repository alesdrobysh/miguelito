import { describe, it, expect } from "vitest";
import { estimateProficiency, type CompetencyVector } from "./competency.js";

function vector(overrides: Partial<CompetencyVector> = {}): CompetencyVector {
  return {
    lexicon: { activeChunks: 0, lexicalRarity: 0.35, confidence: "medium" },
    syntax: { meanTunitLength: 7, subIndex: 0.2, confidence: "medium" },
    morphology: { rate: 0.82, obs: 40, confidence: "high" },
    idiomaticity: { rate: 0.76, obs: 35, confidence: "high" },
    reception: { level: 0.78, obs: 40, confidence: "high", byFrequencyBand: { top_3k: { score: 0.8, obs: 10, confidence: "medium" } } },
    monitoring: { selfCorrectionObs: 3 },
    ...overrides,
  } as CompetencyVector;
}

describe("estimateProficiency", () => {
  it("returns insufficient data when key axes are low confidence", () => {
    const estimate = estimateProficiency(vector({ morphology: { rate: 0.9, obs: 1, confidence: "low" } }));

    expect(estimate.cefr).toBe("insufficient_data");
    expect(Object.keys(estimate.axes)).toEqual(["lexicon", "syntax", "morphology", "idiomaticity", "reception", "monitoring"]);
    expect(estimate.caveats.join(" ")).toMatch(/estimate|observed/i);
  });

  it("returns a readable CEFR estimate with observed-axis evidence", () => {
    const estimate = estimateProficiency(vector());

    expect(estimate.cefr).toMatch(/A2|B1|B2|C1/);
    expect(estimate.axes.lexicon.evidence).toContain("rarity");
    expect(estimate.axes.morphology.interpretation).toContain("accuracy");
    expect(estimate.axes.reception.evidence).toContain("top_3k");
    expect(estimate.caveats.length).toBeGreaterThan(0);
  });
});
