import fs from "fs";
import path from "path";
import { BuddyDb } from "../src/infrastructure/db.js";
import { SpanishLanguage } from "../src/languages/spanish/index.js";

function clip(value: unknown, max = 180): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "buddy.db");
  const reportPath = process.env.REPORT_PATH ?? path.join(process.cwd(), "reports", "fuzzy-dedupe-candidates.md");
  const limit = Number(process.env.LIMIT ?? 50);
  const db = await BuddyDb.open(dbPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
  try {
    const candidates = await db.findFuzzyLearningItemDuplicateCandidates({ limit });
    const lines = [
      "# Fuzzy learning item duplicate candidates",
      "",
      `Generated: ${new Date().toISOString()}`,
      `DB: ${dbPath}`,
      `Candidates: ${candidates.length}`,
      "",
      "This report is an audit shortlist only. It does not merge rows automatically; pairs may be true duplicates, related items, containment/subsumption, or false positives.",
      "",
    ];
    for (const [index, candidate] of candidates.entries()) {
      lines.push(
        `## ${index + 1}. #${candidate.itemA.id} ↔ #${candidate.itemB.id} — score ${candidate.score.toFixed(3)}`,
        "",
        `Reason: ${candidate.reason}`,
        `Similarities: title=${candidate.titleSimilarity.toFixed(3)}, prompt=${candidate.promptSimilarity.toFixed(3)}, explanation=${candidate.explanationSimilarity.toFixed(3)}, tokens=${candidate.tokenSimilarity.toFixed(3)}`,
        "",
        `A: #${candidate.itemA.id} [${candidate.itemA.type}] ${candidate.itemA.title}`,
        `- prompt_l2: ${clip(candidate.itemA.prompt_l2)}`,
        `- explanation_l1: ${clip(candidate.itemA.explanation_l1)}`,
        "",
        `B: #${candidate.itemB.id} [${candidate.itemB.type}] ${candidate.itemB.title}`,
        `- prompt_l2: ${clip(candidate.itemB.prompt_l2)}`,
        `- explanation_l1: ${clip(candidate.itemB.explanation_l1)}`,
        "",
      );
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
    console.log(`Wrote ${candidates.length} candidates to ${reportPath}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
