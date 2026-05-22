import fs from "fs";
import path from "path";
import crypto from "crypto";
import initSqlJs, { Database } from "sql.js";
import { BuddyDb } from "./db.js";

const SCOPED_TABLES = new Set([
  "vocabulary_items",
  "vocabulary_candidates",
  "error_log",
  "turn_annotations",
  "competency_vector",
  "conversation_state",
  "chat_history",
]);
const GLOBAL_TABLES = new Set(["user_profile", "user_interests"]);
const TABLES_WITH_IDS = new Set([...SCOPED_TABLES, ...GLOBAL_TABLES, "vocab_review_attempts"]);

export interface ConsolidationSourceSummary {
  path: string;
  sha256: string;
  bytes: number;
  tableCounts: Record<string, number>;
}

export interface ConsolidationResult {
  targetPath: string;
  sources: ConsolidationSourceSummary[];
}

export interface ConsolidationOptions {
  dataDir: string;
  targetPath?: string;
  sourcePaths?: string[];
  overwrite?: boolean;
}

function queryAll(db: Database, sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function tableNames(db: Database): string[] {
  return queryAll(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => String(r.name));
}

function columns(db: Database, table: string): string[] {
  return queryAll(db, `PRAGMA table_info(${table})`).map((r) => String(r.name));
}

function inferLanguage(sourcePath: string): string {
  const base = path.basename(sourcePath);
  const match = base.match(/^buddy-(.+)\.db$/);
  return match?.[1] === "shared" ? "" : match?.[1] ?? "";
}

function insertRow(db: Database, table: string, row: Record<string, any>, excluded = new Set<string>()): number | null {
  const names = columns(db, table).filter((c) => c !== "id" && !excluded.has(c) && Object.prototype.hasOwnProperty.call(row, c));
  if (names.length === 0) return null;
  const placeholders = names.map(() => "?").join(", ");
  db.run(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders})`, names.map((name) => row[name]));
  const idResult = db.exec("SELECT last_insert_rowid()");
  return Number(idResult[0].values[0][0]);
}

function recordMap(db: Database, sourceDb: string, table: string, oldId: unknown, newId: number | null): void {
  if (oldId === undefined || oldId === null || newId === null) return;
  db.run(
    "INSERT INTO _migration_id_map (source_db, table_name, old_id, new_id) VALUES (?, ?, ?, ?)",
    [sourceDb, table, Number(oldId), newId],
  );
}

function findMappedId(db: Database, sourceDb: string, table: string, oldId: unknown): number | null {
  if (oldId === undefined || oldId === null) return null;
  const rows = queryAll(db, "SELECT new_id FROM _migration_id_map WHERE source_db = ? AND table_name = ? AND old_id = ?", [sourceDb, table, Number(oldId)]);
  return rows.length ? Number(rows[0].new_id) : null;
}

function ensureMigrationTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS _migration_sources (
    source_db TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    migrated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS _migration_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_db TEXT NOT NULL,
    table_name TEXT NOT NULL,
    old_id INTEGER,
    row_json TEXT NOT NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_migration_rows_source_table ON _migration_rows(source_db, table_name)");
  db.run(`CREATE TABLE IF NOT EXISTS _migration_id_map (
    source_db TEXT NOT NULL,
    table_name TEXT NOT NULL,
    old_id INTEGER NOT NULL,
    new_id INTEGER NOT NULL,
    PRIMARY KEY (source_db, table_name, old_id)
  )`);
}

function defaultSources(dataDir: string, targetPath: string): string[] {
  if (!fs.existsSync(dataDir)) return [];
  const targetReal = path.resolve(targetPath);
  return fs.readdirSync(dataDir)
    .filter((name) => /^buddy-.+\.db$/.test(name))
    .map((name) => path.join(dataDir, name))
    .filter((p) => path.resolve(p) !== targetReal)
    .sort();
}

export async function consolidateMiguelitoDatabases(options: ConsolidationOptions): Promise<ConsolidationResult> {
  const targetPath = options.targetPath ?? path.join(options.dataDir, "buddy.db");
  const sourcePaths = (options.sourcePaths ?? defaultSources(options.dataDir, targetPath)).filter((p) => !p.includes(".bak-"));
  if (fs.existsSync(targetPath)) {
    if (!options.overwrite) throw new Error(`Target DB already exists: ${targetPath}`);
    fs.rmSync(targetPath);
  }

  const target = await BuddyDb.open(targetPath, "shared", [], []);
  const targetDb = target.db;
  ensureMigrationTables(targetDb);
  const SQL = await initSqlJs();
  const summaries: ConsolidationSourceSummary[] = [];

  for (const sourcePath of sourcePaths) {
    const buf = fs.readFileSync(sourcePath);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const sourceDbName = path.basename(sourcePath);
    const sourceDb = new SQL.Database(buf);
    const names = tableNames(sourceDb).filter((name) => !name.startsWith("_migration_"));
    const tableCounts: Record<string, number> = {};
    const inferredLanguage = inferLanguage(sourcePath);

    targetDb.run("INSERT INTO _migration_sources (source_db, sha256, bytes) VALUES (?, ?, ?)", [sourceDbName, sha256, buf.length]);

    for (const table of names) {
      const rows = queryAll(sourceDb, `SELECT * FROM ${table}`);
      tableCounts[table] = rows.length;
      for (const row of rows) {
        targetDb.run(
          "INSERT INTO _migration_rows (source_db, table_name, old_id, row_json) VALUES (?, ?, ?, ?)",
          [sourceDbName, table, row.id ?? null, JSON.stringify(row)],
        );
      }
    }

    for (const table of [...SCOPED_TABLES]) {
      if (!names.includes(table)) continue;
      for (const row of queryAll(sourceDb, `SELECT * FROM ${table}`)) {
        const next = { ...row };
        if (Object.prototype.hasOwnProperty.call(next, "language") && !next.language) next.language = inferredLanguage;
        let newId: number | null = null;
        try {
          newId = insertRow(targetDb, table, next);
        } catch (err: any) {
          if (table === "vocabulary_items") {
            const existing = queryAll(targetDb, "SELECT id FROM vocabulary_items WHERE language = ? AND chunk_l2 = ? COLLATE NOCASE", [next.language, next.chunk_l2]);
            newId = existing.length ? Number(existing[0].id) : null;
          } else {
            throw err;
          }
        }
        if (TABLES_WITH_IDS.has(table)) recordMap(targetDb, sourceDbName, table, row.id, newId);
      }
    }

    if (names.includes("vocab_review_attempts")) {
      for (const row of queryAll(sourceDb, "SELECT * FROM vocab_review_attempts")) {
        const next = { ...row };
        if (!next.language) next.language = inferredLanguage;
        const mappedVocabId = findMappedId(targetDb, sourceDbName, "vocabulary_items", next.vocab_id);
        if (mappedVocabId !== null) next.vocab_id = mappedVocabId;
        const newId = insertRow(targetDb, "vocab_review_attempts", next);
        recordMap(targetDb, sourceDbName, "vocab_review_attempts", row.id, newId);
      }
    }

    if (names.includes("user_interests")) {
      for (const row of queryAll(sourceDb, "SELECT * FROM user_interests")) {
        const existing = queryAll(targetDb, "SELECT id, confidence FROM user_interests WHERE interest = ? COLLATE NOCASE", [row.interest]);
        if (existing.length) {
          targetDb.run(
            "UPDATE user_interests SET source = ?, confidence = MAX(confidence, ?), first_seen_at = MIN(first_seen_at, ?), last_seen_at = MAX(last_seen_at, ?) WHERE id = ?",
            [row.source, row.confidence ?? 0.5, row.first_seen_at, row.last_seen_at, existing[0].id],
          );
          recordMap(targetDb, sourceDbName, "user_interests", row.id, Number(existing[0].id));
        } else {
          const newId = insertRow(targetDb, "user_interests", row);
          recordMap(targetDb, sourceDbName, "user_interests", row.id, newId);
        }
      }
    }

    if (names.includes("user_profile")) {
      for (const row of queryAll(sourceDb, "SELECT * FROM user_profile")) {
        const current = queryAll(targetDb, "SELECT updated_at FROM user_profile WHERE id = 1");
        if (!current.length || String(row.updated_at ?? "") >= String(current[0].updated_at ?? "")) {
          targetDb.run("DELETE FROM user_profile WHERE id = 1");
          targetDb.run(
            "INSERT INTO user_profile (id, name, goal, correction_style, started_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)",
            [row.name ?? null, row.goal ?? null, row.correction_style ?? null, row.started_at ?? null, row.updated_at ?? new Date().toISOString()],
          );
        }
        recordMap(targetDb, sourceDbName, "user_profile", row.id, 1);
      }
    }

    summaries.push({ path: sourcePath, sha256, bytes: buf.length, tableCounts });
    sourceDb.close();
  }

  target.close();
  return { targetPath, sources: summaries };
}
