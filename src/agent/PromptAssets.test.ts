import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const projectRoot = path.resolve(__dirname, "..", "..");
const soulPaths = [
  "src/languages/spanish/soul.md",
].map((p) => path.join(projectRoot, p));

const postTurnOwnedToolNames = [
  "miguelito_turn_annotate",
  "miguelito_error_log",
  "miguelito_vocab_add",
  "miguelito_vocab_score",
  "miguelito_vocab_attempt_start",
  "miguelito_vocab_attempt_finish",
];

const nonHumanIdentityPhrases = [
  { path: "src/languages/spanish/soul.md", phrase: "No finjas ser una persona" },
];

const configIdentityPhrases = [
  { path: "src/languages/spanish/config.ts", phrases: ["tutor de español por software", "No finjas ser una persona", "No finjas vida humana propia"] },
];

describe("language prompt assets", () => {
  it("do not instruct the chat model to call post-turn evaluator-owned tools", () => {
    for (const soulPath of soulPaths) {
      const content = fs.readFileSync(soulPath, "utf8");
      for (const toolName of postTurnOwnedToolNames) {
        expect(content, `${path.relative(projectRoot, soulPath)} should not mention ${toolName}`).not.toContain(toolName);
      }
    }
  });

  it("keeps non-human tutor identity guardrails in each soul prompt", () => {
    for (const { path: relativePath, phrase } of nonHumanIdentityPhrases) {
      const content = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
      expect(content, `${relativePath} should forbid human impersonation`).toContain(phrase);
    }
  });

  it("repeats non-human identity guardrails in language blocks and cron prompts", () => {
    for (const { path: relativePath, phrases } of configIdentityPhrases) {
      const content = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
      for (const phrase of phrases) {
        expect(content, `${relativePath} should contain ${phrase}`).toContain(phrase);
      }
    }
  });
});
