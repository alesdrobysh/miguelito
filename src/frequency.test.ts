import { describe, expect, it } from "vitest";
import { analyzeTextDifficulty } from "./domain/frequency.js";
import { SpanishLanguage } from "./languages/spanish/index.js";
import { PolishLanguage } from "./languages/polish/index.js";

describe("frequency-based difficulty", () => {
  it("uses bundled Spanish frequency lists to separate common and rare lexical input", () => {
    const common = analyzeTextDifficulty("quiero comer algo en casa", SpanishLanguage);
    const rare = analyzeTextDifficulty("prefiero soslayar la cuestión con parsimonia", SpanishLanguage);

    expect(SpanishLanguage.frequency?.topWords.length).toBeGreaterThanOrEqual(10_000);
    expect(common.lexicalDifficulty).toBeLessThan(rare.lexicalDifficulty);
    expect(rare.rareTokens.length).toBeGreaterThan(0);
  });

  it("uses bundled Polish frequency lists to separate common and rare lexical input", () => {
    const common = analyzeTextDifficulty("chcę coś zjeść w domu", PolishLanguage);
    const rare = analyzeTextDifficulty("lekceważę zawiłości przedsięwzięcia", PolishLanguage);

    expect(PolishLanguage.frequency?.topWords.length).toBeGreaterThanOrEqual(10_000);
    expect(common.lexicalDifficulty).toBeLessThan(rare.lexicalDifficulty);
    expect(rare.rareTokens.length).toBeGreaterThan(0);
  });
});
