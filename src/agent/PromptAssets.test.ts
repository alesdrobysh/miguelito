import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const projectRoot = path.resolve(__dirname, "..", "..");
const soulPaths = [
  "src/languages/spanish/soul.md",
  "src/languages/polish/soul.md",
  "src/languages/belarusian/soul.md",
].map((p) => path.join(projectRoot, p));

const postTurnOwnedToolNames = [
  "miguelito_turn_annotate",
  "miguelito_error_log",
  "miguelito_vocab_add",
  "miguelito_vocab_score",
  "miguelito_vocab_attempt_finish",
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
});
