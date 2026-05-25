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

  it("keeps each language's prompt assets in that target language", () => {
    const englishPromptPhrases = [
      "You are",
      "Respond in",
      "The learner is learning",
      "Call tools BEFORE",
      "Every user turn",
      "New Spanish construction",
      "New Belarusian word",
      "Check ## Learner Profile",
      "Send a single short",
      "Never output mode names",
      "You have just finished",
      "Update the learner",
      "Rules:",
      "Focus on:",
      "Return the existing profile unchanged",
    ];

    for (const lang of listAvailableLanguages()) {
      const soul = fs.readFileSync(lang.soulPath, "utf8");
      const promptText = [
        ...Object.values(lang.prompts).map((prompt) =>
          typeof prompt === "string" ? prompt : prompt("Example title", "Example body"),
        ),
        lang.calibrationText.morphologyLow,
        lang.calibrationText.morphologyFocus(80),
        lang.calibrationText.morphologyNormal,
        lang.calibrationText.idiomaticityLow,
        lang.calibrationText.idiomaticityFocus(80),
        lang.calibrationText.idiomaticityNormal,
      ].join("\n");

      for (const phrase of englishPromptPhrases) {
        expect(soul, `${lang.id} soul.md contains English phrase: ${phrase}`).not.toContain(phrase);
        expect(promptText, `${lang.id} prompts contain English phrase: ${phrase}`).not.toContain(phrase);
      }
    }
  });
});
