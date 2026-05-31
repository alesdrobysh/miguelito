import { describe, expect, it } from "vitest";
import { analyzeTextDifficulty } from "./domain/frequency.js";
import { SpanishLanguage } from "./languages/spanish/index.js";

describe("frequency-based difficulty", () => {
  it("uses bundled Spanish frequency lists to separate common and rare lexical input", () => {
    const common = analyzeTextDifficulty("quiero comer algo en casa", SpanishLanguage);
    const rare = analyzeTextDifficulty("prefiero soslayar la cuestión con parsimonia", SpanishLanguage);

    expect(SpanishLanguage.frequency?.topWords.length).toBeGreaterThanOrEqual(10_000);
    expect(common.lexicalDifficulty).toBeLessThan(rare.lexicalDifficulty);
    expect(rare.rareTokens.length).toBeGreaterThan(0);
  });

  it("does not treat OOV proper nouns and typos as C2 evidence by themselves", () => {
    const profile = analyzeTextDifficulty("Teide powerbank opcioces mapa-tyrystyczna", SpanishLanguage);
    expect(["A1", "A2", "B1", "B2"]).toContain(profile.estimatedLevel);
    expect(profile.rareTokens.map((t) => t.token)).toContain("teide");
  });
});
