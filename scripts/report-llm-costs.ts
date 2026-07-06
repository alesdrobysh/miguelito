import fs from "fs";
import path from "path";
import { loadConfig } from "../src/infrastructure/config.js";
import { BuddyDb } from "../src/infrastructure/db.js";
import { SpanishLanguage } from "../src/languages/spanish/index.js";

function rows(db: any, sql: string, params: any[] = []): any[][] {
  return db.exec(sql, params)[0]?.values ?? [];
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...(lines.length ? lines : ["- no usage yet"]), ""].join("\n");
}

function money(value: unknown): string {
  return `$${Number(value ?? 0).toFixed(6)}`;
}

async function main() {
  const days = Math.max(1, Number(process.argv[2] ?? 7));
  const config = loadConfig({ ...process.env, PROVIDER: process.env.PROVIDER ?? "ollama", TRANSPORT: process.env.TRANSPORT ?? "tui" });
  const db = await BuddyDb.open(config.dbPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
  const since = `-${days} days`;

  const byUser = rows(db.db, `
    SELECT COALESCE(users.external_user_id, 'user:' || llm_usage.user_id),
           ROUND(SUM(COALESCE(cost_usd, 0)), 6), SUM(COALESCE(total_tokens, 0)), COUNT(*)
    FROM llm_usage LEFT JOIN users ON users.id = llm_usage.user_id
    WHERE llm_usage.created_at >= datetime('now', ?)
    GROUP BY llm_usage.user_id
    ORDER BY SUM(COALESCE(cost_usd, 0)) DESC
  `, [since]);

  const byDay = rows(db.db, `
    SELECT date(created_at, 'localtime'), ROUND(SUM(COALESCE(cost_usd, 0)), 6), SUM(COALESCE(total_tokens, 0)), COUNT(*)
    FROM llm_usage
    WHERE llm_usage.created_at >= datetime('now', ?)
    GROUP BY date(created_at, 'localtime')
    ORDER BY 1 DESC
  `, [since]);

  const byPurpose = rows(db.db, `
    SELECT purpose, model, ROUND(SUM(COALESCE(cost_usd, 0)), 6), SUM(COALESCE(total_tokens, 0)), COUNT(*)
    FROM llm_usage
    WHERE llm_usage.created_at >= datetime('now', ?)
    GROUP BY purpose, model
    ORDER BY SUM(COALESCE(cost_usd, 0)) DESC
  `, [since]);

  const lines = [
    `# LLM costs (${days}d, ${new Date().toISOString()})`,
    "",
    section("By user", byUser.map(([user, cost, tokens, calls]) => `- ${user}: ${money(cost)}, ${tokens} tokens, ${calls} calls`)),
    section("By day", byDay.map(([day, cost, tokens, calls]) => `- ${day}: ${money(cost)}, ${tokens} tokens, ${calls} calls`)),
    section("By purpose/model", byPurpose.map(([purpose, model, cost, tokens, calls]) => `- ${purpose} / ${model}: ${money(cost)}, ${tokens} tokens, ${calls} calls`)),
  ];

  fs.mkdirSync("reports", { recursive: true });
  const out = path.join("reports", "llm-costs.md");
  fs.writeFileSync(out, lines.join("\n"));
  db.close();
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
