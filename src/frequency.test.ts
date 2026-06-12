import { describe, expect, it } from "vitest";
import { analyzeTextDifficulty } from "./domain/frequency.js";
import { SpanishLanguage } from "./languages/spanish/index.js";

describe("frequency-based difficulty", () => {
  it("uses bundled Spanish frequency lists to separate common and rare lexical input", () => {
    const common = analyzeTextDifficulty("quiero comer algo en casa", SpanishLanguage);
    const rare = analyzeTextDifficulty("prefiero soslayar la cuestión con parsimonia", SpanishLanguage);

    expect(SpanishLanguage.frequency?.topWords.length).toBeGreaterThanOrEqual(10_000);
    expect(common.lexicalRarity).toBeLessThan(rare.lexicalRarity);
    expect(rare.rareTokens.length).toBeGreaterThan(0);
    expect(rare.highestBand).not.toBe("top_1k");
  }, 15_000);

  it("treats OOV proper nouns and typos as unknown frequency evidence", () => {
    const profile = analyzeTextDifficulty("Teide powerbank opcioces mapa-tyrystyczna", SpanishLanguage);
    expect(profile.highestBand).toBe("rare_or_unknown");
    expect(profile.rareTokens.map((t) => t.token)).toContain("teide");
    expect(Object.keys(profile)).toEqual(expect.arrayContaining(["lexicalRarity", "highestBand", "rareTokens"]));
  });
});
