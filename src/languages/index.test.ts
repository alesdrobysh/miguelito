import { describe, it, expect } from "vitest";
import { loadLanguage } from "./index.js";

describe("loadLanguage", () => {
  it("returns Spanish config", () => {
    const lang = loadLanguage("spanish");
    expect(lang.id).toBe("spanish");
    expect(lang.errorCategories).toContain("ser_estar");
    expect(lang.morphologyCategories).toContain("verb_conjugation");
    expect(lang.calibrationThresholds.morphology).toBe(0.75);
  });

  it("returns Polish config", () => {
    const lang = loadLanguage("polish");
    expect(lang.id).toBe("polish");
    expect(lang.errorCategories).toContain("case");
    expect(lang.morphologyCategories).toContain("aspect");
  });

  it("returns Belarusian config", () => {
    const lang = loadLanguage("belarusian");
    expect(lang.id).toBe("belarusian");
    expect(lang.errorCategories).toContain("case");
    expect(lang.morphologyCategories).toContain("aspect");
  });

  it("throws for unknown language", () => {
    expect(() => loadLanguage("klingon")).toThrow('Unknown language: "klingon"');
  });
});
