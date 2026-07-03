import fs from "fs";
import path from "path";
import { loadConfig } from "../src/infrastructure/config.js";
import { BuddyDb } from "../src/infrastructure/db.js";
import { SpanishLanguage } from "../src/languages/spanish/index.js";

function firstNumber(rows: any[][]): number {
  return Number(rows[0]?.[0] ?? 0);
}

function table(db: any, sql: string, params: any[] = []): any[][] {
  return db.exec(sql, params)[0]?.values ?? [];
}

function section(title: string, rows: string[]): string {
  return [`## ${title}`, ...rows, ""].join("\n");
}

async function main() {
  const config = loadConfig({ ...process.env, PROVIDER: process.env.PROVIDER ?? "ollama", TRANSPORT: process.env.TRANSPORT ?? "tui" });
  const db = await BuddyDb.open(config.dbPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
  const raw = db.db;
  const statusRows = table(raw, "SELECT status, COUNT(*) FROM learning_items WHERE language = 'spanish' GROUP BY status ORDER BY status");
  const severityRows = table(raw, "SELECT COALESCE(NULLIF(substr(note, instr(note, 'severity:') + 9), ''), 'unknown') AS severity, COUNT(*) FROM error_log WHERE language = 'spanish' AND note LIKE '%severity:%' GROUP BY severity ORDER BY severity");
  const attemptsStarted = firstNumber(table(raw, "SELECT COUNT(*) FROM learning_practice_attempts WHERE language = 'spanish'"));
  const attemptsCompleted = firstNumber(table(raw, "SELECT COUNT(*) FROM learning_practice_attempts WHERE language = 'spanish' AND status = 'completed'"));
  const attemptsAbandoned = firstNumber(table(raw, "SELECT COUNT(*) FROM learning_practice_attempts WHERE language = 'spanish' AND status = 'abandoned'"));
  const avgGrade = table(raw, "SELECT ROUND(AVG(grade), 2) FROM learning_practice_attempts WHERE language = 'spanish' AND grade IS NOT NULL")[0]?.[0] ?? "n/a";
  const freqRows = table(raw, "SELECT challenge_band, COUNT(*), ROUND(AVG(CASE outcome WHEN 'success' THEN 1.0 WHEN 'partial' THEN 0.5 ELSE 0 END), 2) FROM proficiency_evidence WHERE language = 'spanish' AND skill = 'reception' GROUP BY challenge_band ORDER BY challenge_band");
  const lines = [
    `# Learning metrics (${new Date().toISOString()})`,
    "",
    section("/drill", [
      `- started: ${attemptsStarted}`,
      `- completed: ${attemptsCompleted}`,
      `- abandoned: ${attemptsAbandoned}`,
      `- average grade: ${avgGrade}`,
    ]),
    section("Error severity", severityRows.length ? severityRows.map(([s, c]) => `- ${s}: ${c}`) : ["- no severity-tagged errors yet"]),
    section("Learning items by status", statusRows.length ? statusRows.map(([s, c]) => `- ${s}: ${c}`) : ["- no learning items"]),
    section("Reception by frequency band", freqRows.length ? freqRows.map(([band, count, score]) => `- ${band}: ${count} obs, avg ${score}`) : ["- no frequency-band evidence"]),
  ];
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(path.join("reports", "learning-metrics.md"), lines.join("\n"));
  db.close();
  console.log("wrote reports/learning-metrics.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
