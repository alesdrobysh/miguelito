import { describe, it, expect } from "vitest";
import fs from "fs";
import { listAvailableLanguages, loadLanguage } from "./index.js";

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

  it("does not hard-code personal names in core language prompts", () => {
    const forbiddenPersonalNames = /\b(Ales|Alejandro)\b|Алесь|Алес/;

    for (const lang of listAvailableLanguages()) {
      const soul = fs.readFileSync(lang.soulPath, "utf8");
      const promptText = Object.values(lang.prompts)
        .map((prompt) => (typeof prompt === "string" ? prompt : ""))
        .join("\n");

      expect(`${lang.id} soul.md`).not.toMatch(forbiddenPersonalNames);
      expect(`${lang.id} static prompts`).not.toMatch(forbiddenPersonalNames);
      expect(soul).not.toMatch(forbiddenPersonalNames);
      expect(promptText).not.toMatch(forbiddenPersonalNames);
    }
  });
});
