import { describe, expect, it } from "vitest";
import { SpanishLanguage } from "./index.js";

describe("Spanish prompt assets", () => {
  it("keeps proactive cron prompts from asking for the learner name when it is missing", () => {
    for (const prompt of [SpanishLanguage.prompts.morning, SpanishLanguage.prompts.evening]) {
      expect(prompt).toContain("si no hay un nombre real");
      expect(prompt).toContain("NO lo preguntes");
      expect(prompt).toContain("no hagas onboarding");
    }
  });
});