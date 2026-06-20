import fs from "fs";
import path from "path";
import { BuddyDb } from "../src/infrastructure/db.js";
import { loadConfig } from "../src/infrastructure/config.js";
import { createEvaluatorProvider } from "../src/runtime.js";
import { SpanishLanguage } from "../src/languages/spanish/index.js";
import { FuzzyDedupeService } from "../src/services/FuzzyDedupeService.js";
import type { FuzzyDedupeApplyResult } from "../src/services/FuzzyDedupeService.js";

function clip(value: unknown, max = 180): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatReport(result: FuzzyDedupeApplyResult, apply: boolean, minConfidence: number): string {
  const lines = [
    "# LLM fuzzy dedupe adjudication",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${apply ? "APPLY" : "audit-only"}`,
    `Candidates: ${result.candidates.length}`,
    `Decisions: ${result.decisions.length}`,
    `Applied merges: ${result.appliedMerges}`,
    `Skipped merge decisions: ${result.skippedMerges}`,
    `Min confidence: ${minConfidence}`,
    "",
  ];
  for (const decision of result.decisions) {
    const candidate = result.candidates.find((c) => {
      const ids = [c.itemA.id, c.itemB.id].sort((a, b) => a - b);
      const dIds = [decision.itemAId, decision.itemBId].sort((a, b) => a - b);
      return ids[0] === dIds[0] && ids[1] === dIds[1];
    });
    lines.push(
      `## #${decision.itemAId} ↔ #${decision.itemBId}: ${decision.decision} (${decision.confidence.toFixed(2)})`,
      "",
      `Reason: ${decision.reason}`,
      decision.keeperId ? `Keeper: #${decision.keeperId}` : "Keeper: n/a",
    );
    if (candidate) {
      lines.push(
        `Similarity: score=${candidate.score.toFixed(3)}, title=${candidate.titleSimilarity.toFixed(3)}, prompt=${candidate.promptSimilarity.toFixed(3)}, explanation=${candidate.explanationSimilarity.toFixed(3)}, tokens=${candidate.tokenSimilarity.toFixed(3)}`,
        "",
        `A: #${candidate.itemA.id} [${candidate.itemA.type}] ${candidate.itemA.title}`,
        `- prompt_l2: ${clip(candidate.itemA.prompt_l2)}`,
        `- explanation_l1: ${clip(candidate.itemA.explanation_l1)}`,
        "",
        `B: #${candidate.itemB.id} [${candidate.itemB.type}] ${candidate.itemB.title}`,
        `- prompt_l2: ${clip(candidate.itemB.prompt_l2)}`,
        `- explanation_l1: ${clip(candidate.itemB.explanation_l1)}`,
      );
    }
    if (decision.mergedTitle || decision.mergedPromptL2 || decision.mergedExplanationL1) {
      lines.push(
        "",
        "Suggested merged fields:",
        `- title: ${decision.mergedTitle ?? ""}`,
        `- prompt_l2: ${decision.mergedPromptL2 ?? ""}`,
        `- explanation_l1: ${decision.mergedExplanationL1 ?? ""}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const apply = process.env.APPLY === "1" || process.argv.includes("--apply");
  const limit = Number(process.env.LIMIT ?? 50);
  const batchSize = Number(process.env.BATCH_SIZE ?? 8);
  const minConfidence = Number(process.env.MIN_CONFIDENCE ?? 0.92);
  const reportPath = process.env.REPORT_PATH ?? path.join(process.cwd(), "reports", "fuzzy-dedupe-llm-adjudication.md");
  const config = loadConfig(process.env);
  const db = await BuddyDb.open(config.dbPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
  try {
    const provider = createEvaluatorProvider(config);
    const service = new FuzzyDedupeService(db, provider);
    const result: FuzzyDedupeApplyResult = apply
      ? await service.adjudicateAndApply({ limit, minConfidence, batchSize })
      : { ...(await service.adjudicate({ limit, batchSize })), appliedMerges: 0, skippedMerges: 0 };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, formatReport(result, apply, minConfidence), "utf8");
    if (!apply && result.appliedMerges > 0) {
      throw new Error("Internal error: audit-only mode applied merges");
    }
    if (!apply) {
      console.log(`Adjudicated ${result.decisions.length}/${result.candidates.length} candidates; audit report: ${reportPath}`);
      console.log("No merges applied. Re-run with APPLY=1 or --apply to apply high-confidence merge decisions.");
      return;
    }
    console.log(`Adjudicated ${result.decisions.length}/${result.candidates.length} candidates; applied ${result.appliedMerges} merges; report: ${reportPath}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
