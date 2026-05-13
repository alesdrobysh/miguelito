import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { fsrsInitial, fsrsReview, statusOf, Grade } from "../domain/fsrs.js";
import type {
  ChunkItem, DueChunkItem, ErrorItem, UserProfile, ConversationStateData,
  ConversationStateResult, FsrsReviewResult, ProgressData, UpdateResult,
  TurnAnnotationInput, TurnAnnotation, CompetencyVectorRow,
} from "../domain/types.js";
import { VALID_CATEGORIES } from "../domain/types.js";
import type {
  VocabRepository, ErrorRepository, SessionRepository, ProfileRepository,
  InterestRepository, CompetencyRepository,
} from "../repositories/interfaces.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vocabulary_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_l2 TEXT NOT NULL,
    anchor TEXT,
    capture_context_l2 TEXT,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    pro_stability REAL DEFAULT 1.0,
    pro_difficulty REAL DEFAULT 5.0,
    pro_due DATETIME,
    pro_last_review DATETIME,
    pro_reps INTEGER DEFAULT 0,
    rec_stability REAL DEFAULT 1.0,
    rec_difficulty REAL DEFAULT 5.0,
    rec_due DATETIME,
    rec_last_review DATETIME,
    rec_reps INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_text TEXT NOT NULL,
    correct_form TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_error_category ON error_log(category);
CREATE INDEX IF NOT EXISTS idx_error_created ON error_log(created_at);

CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name TEXT,
    goal TEXT,
    correction_style TEXT,
    started_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS turn_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    turn_number INTEGER,
    obligatory_json TEXT NOT NULL DEFAULT '[]',
    used_json TEXT NOT NULL DEFAULT '[]',
    naturalness REAL,
    comprehension TEXT NOT NULL DEFAULT 'smooth',
    tunit_length INTEGER NOT NULL DEFAULT 1,
    had_subordination INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotation_created ON turn_annotations(created_at);

CREATE TABLE IF NOT EXISTS competency_vector (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    morph_successes REAL NOT NULL DEFAULT 0.5,
    morph_trials REAL NOT NULL DEFAULT 1.0,
    morph_obs INTEGER NOT NULL DEFAULT 0,
    idiom_successes REAL NOT NULL DEFAULT 0.5,
    idiom_trials REAL NOT NULL DEFAULT 1.0,
    idiom_obs INTEGER NOT NULL DEFAULT 0,
    syntax_window TEXT NOT NULL DEFAULT '[]',
    reception_ewma REAL NOT NULL DEFAULT 0.5,
    reception_obs INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _buddy_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interest TEXT NOT NULL COLLATE NOCASE,
    source TEXT DEFAULT 'conversation',
    confidence REAL DEFAULT 0.5,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_interest_unique ON user_interests(interest COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS conversation_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    turn_count INTEGER DEFAULT 0,
    last_mode TEXT,
    last_two_modes TEXT DEFAULT '[]',
    topics_touched TEXT DEFAULT '[]',
    mood_hint TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_history_chat_id ON chat_history(chat_id, id);
`;

export const MORPHOLOGY_TYPES = new Set([
  "verb_conjugation",
  "agreement",
  "ser_estar",
  "gender",
]);

export type { ChunkItem, DueChunkItem, ErrorItem, UserProfile, ConversationStateResult, FsrsReviewResult, ProgressData, UpdateResult, TurnAnnotationInput, TurnAnnotation, CompetencyVectorRow } from "../domain/types.js";

function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function computeNextReview(intervalDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + intervalDays);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function computeElapsedDays(lastReviewIso: string): number {
  const last = new Date(lastReviewIso.replace(" ", "T"));
  return Math.max(0.1, (Date.now() - last.getTime()) / 86400000);
}

function normalizeCategory(category: string): string {
  if (VALID_CATEGORIES.has(category)) return category;
  return "other";
}

export class BuddyDb implements VocabRepository, ErrorRepository, SessionRepository, ProfileRepository, InterestRepository, CompetencyRepository {
  readonly db: Database;
  private dbPath: string;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  private static runMigrations(db: Database): void {
    // v1: chat_history.session_id
    const chatInfo = db.exec("PRAGMA table_info(chat_history)");
    const chatCols = (chatInfo[0]?.values ?? []).map((r) => r[1] as string);
    if (!chatCols.includes("session_id")) {
      db.run("ALTER TABLE chat_history ADD COLUMN session_id TEXT");
      db.run("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id)");
    }

    const verRow = db.exec("SELECT value FROM _buddy_meta WHERE key = 'schema_version'");
    const ver = verRow[0]?.values[0]?.[0] as string | undefined;
    if (ver === "6") return;

    // v3: rebuild vocabulary_items — word+translation → chunk_l2 (L2-only) + FSRS state
    const vocabInfo = db.exec("PRAGMA table_info(vocabulary_items)");
    const vocabCols = (vocabInfo[0]?.values ?? []).map((r) => r[1] as string);
    if (vocabCols.includes("word") && !vocabCols.includes("chunk_l2")) {
      db.run(`
        CREATE TABLE vocabulary_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chunk_l2 TEXT NOT NULL,
          anchor TEXT,
          capture_context_l2 TEXT,
          first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          pro_stability REAL DEFAULT 1.0,
          pro_difficulty REAL DEFAULT 5.0,
          pro_due DATETIME,
          pro_last_review DATETIME,
          pro_reps INTEGER DEFAULT 0,
          rec_stability REAL DEFAULT 1.0,
          rec_difficulty REAL DEFAULT 5.0,
          rec_due DATETIME,
          rec_last_review DATETIME,
          rec_reps INTEGER DEFAULT 0
        )
      `);
      db.run(`
        INSERT INTO vocabulary_items_new (id, chunk_l2, anchor, capture_context_l2, first_seen_at)
        SELECT id, word, NULL, context_first_seen, first_seen_at FROM vocabulary_items
      `);
      db.run("DROP TABLE vocabulary_items");
      db.run("ALTER TABLE vocabulary_items_new RENAME TO vocabulary_items");
      db.run("CREATE UNIQUE INDEX idx_vocab_chunk_unique ON vocabulary_items(chunk_l2 COLLATE NOCASE)");
      db.run("CREATE INDEX idx_vocab_pro_due ON vocabulary_items(pro_due)");
    }

    // v4: drop dead columns (status, user_profile.interests/setup_step, conversation_state.corrections_this_session)
    const vocabColsNow = (db.exec("PRAGMA table_info(vocabulary_items)")[0]?.values ?? []).map((r) => r[1] as string);
    if (vocabColsNow.includes("status")) {
      db.run(`
        CREATE TABLE vocabulary_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chunk_l2 TEXT NOT NULL,
          anchor TEXT,
          capture_context_l2 TEXT,
          first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          pro_stability REAL DEFAULT 1.0,
          pro_difficulty REAL DEFAULT 5.0,
          pro_due DATETIME,
          pro_last_review DATETIME,
          pro_reps INTEGER DEFAULT 0,
          rec_stability REAL DEFAULT 1.0,
          rec_difficulty REAL DEFAULT 5.0,
          rec_due DATETIME,
          rec_last_review DATETIME,
          rec_reps INTEGER DEFAULT 0
        )
      `);
      db.run(`
        INSERT INTO vocabulary_items_new
          (id, chunk_l2, anchor, capture_context_l2, first_seen_at,
           pro_stability, pro_difficulty, pro_due, pro_last_review, pro_reps,
           rec_stability, rec_difficulty, rec_due, rec_last_review, rec_reps)
        SELECT
          id, chunk_l2, anchor, capture_context_l2, first_seen_at,
          pro_stability, pro_difficulty, pro_due, pro_last_review, pro_reps,
          rec_stability, rec_difficulty, rec_due, rec_last_review, rec_reps
        FROM vocabulary_items
      `);
      db.run("DROP TABLE vocabulary_items");
      db.run("ALTER TABLE vocabulary_items_new RENAME TO vocabulary_items");
      db.run("CREATE UNIQUE INDEX idx_vocab_chunk_unique ON vocabulary_items(chunk_l2 COLLATE NOCASE)");
      db.run("CREATE INDEX idx_vocab_pro_due ON vocabulary_items(pro_due)");
    }

    const profileCols = (db.exec("PRAGMA table_info(user_profile)")[0]?.values ?? []).map((r) => r[1] as string);
    if (profileCols.includes("interests") || profileCols.includes("setup_step")) {
      db.run(`
        CREATE TABLE user_profile_new (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          name TEXT,
          native_language TEXT,
          level TEXT,
          goal TEXT,
          correction_style TEXT,
          started_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.run(`
        INSERT INTO user_profile_new (id, name, native_language, level, goal, correction_style, started_at, updated_at)
        SELECT id, name, native_language, level, goal, correction_style, started_at, updated_at FROM user_profile
      `);
      db.run("DROP TABLE user_profile");
      db.run("ALTER TABLE user_profile_new RENAME TO user_profile");
    }

    const convCols = (db.exec("PRAGMA table_info(conversation_state)")[0]?.values ?? []).map((r) => r[1] as string);
    if (convCols.includes("corrections_this_session")) {
      db.run(`
        CREATE TABLE conversation_state_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          turn_count INTEGER DEFAULT 0,
          last_mode TEXT,
          last_two_modes TEXT DEFAULT '[]',
          topics_touched TEXT DEFAULT '[]',
          mood_hint TEXT,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      db.run(`
        INSERT INTO conversation_state_new
          (id, session_id, turn_count, last_mode, last_two_modes, topics_touched, mood_hint, started_at, updated_at)
        SELECT
          id, session_id, turn_count, last_mode, last_two_modes, topics_touched, mood_hint, started_at, updated_at
        FROM conversation_state
      `);
      db.run("DROP TABLE conversation_state");
      db.run("ALTER TABLE conversation_state_new RENAME TO conversation_state");
    }

    // v6: convert competency_vector from single-row (id=1 constraint) to append-only time-series.
    // Detect old schema by presence of `updated_at` column (new schema uses `created_at`).
    const cvCols = (db.exec("PRAGMA table_info(competency_vector)")[0]?.values ?? []).map((r) => r[1] as string);
    if (cvCols.includes("updated_at")) {
      const oldRows = db.exec("SELECT morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs FROM competency_vector LIMIT 1");
      db.run("DROP TABLE competency_vector");
      db.run(`CREATE TABLE competency_vector (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        morph_successes REAL NOT NULL DEFAULT 0.5,
        morph_trials REAL NOT NULL DEFAULT 1.0,
        morph_obs INTEGER NOT NULL DEFAULT 0,
        idiom_successes REAL NOT NULL DEFAULT 0.5,
        idiom_trials REAL NOT NULL DEFAULT 1.0,
        idiom_obs INTEGER NOT NULL DEFAULT 0,
        syntax_window TEXT NOT NULL DEFAULT '[]',
        reception_ewma REAL NOT NULL DEFAULT 0.5,
        reception_obs INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      const oldRow = oldRows[0]?.values[0];
      if (oldRow) {
        db.run(
          `INSERT INTO competency_vector (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          oldRow as any[]
        );
      } else {
        db.run("INSERT INTO competency_vector DEFAULT VALUES");
      }
    } else if (cvCols.length > 0) {
      // New schema already, just seed if empty
      const count = db.exec("SELECT COUNT(*) FROM competency_vector")[0]?.values[0]?.[0] as number;
      if (!count) db.run("INSERT INTO competency_vector DEFAULT VALUES");
    } else {
      // Table didn't exist (very old DB, pre-v5) — SCHEMA created it with new schema above
      db.run("INSERT INTO competency_vector DEFAULT VALUES");
    }

    // v7: drop obsolete learner_assessments table
    db.run("DROP TABLE IF EXISTS learner_assessments");

    // v8: drop native_language and level from user_profile
    const profileColsV8 = (db.exec("PRAGMA table_info(user_profile)")[0]?.values ?? []).map((r) => r[1] as string);
    if (profileColsV8.includes("native_language") || profileColsV8.includes("level")) {
      db.run(`CREATE TABLE user_profile_new (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        name TEXT,
        goal TEXT,
        correction_style TEXT,
        started_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.run(`INSERT INTO user_profile_new (id, name, goal, correction_style, started_at, updated_at)
        SELECT id, name, goal, correction_style, started_at, updated_at FROM user_profile`);
      db.run("DROP TABLE user_profile");
      db.run("ALTER TABLE user_profile_new RENAME TO user_profile");
    }

    db.run("INSERT OR REPLACE INTO _buddy_meta (key, value) VALUES ('schema_version', '8')");
    try {
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_chunk_unique ON vocabulary_items(chunk_l2 COLLATE NOCASE)");
      db.run("CREATE INDEX IF NOT EXISTS idx_vocab_pro_due ON vocabulary_items(pro_due)");
    } catch {}
  }

  static async open(dbPath: string): Promise<BuddyDb> {
    const SQL = await initSqlJs();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let buf: Uint8Array | undefined;
    if (fs.existsSync(dbPath)) {
      buf = new Uint8Array(fs.readFileSync(dbPath));
    }
    const db = new SQL.Database(buf);
    db.run(SCHEMA);
    BuddyDb.runMigrations(db);
    return new BuddyDb(db, dbPath);
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private queryRow(sql: string, params?: any[]): any {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    try {
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  private queryAll(sql: string, params?: any[]): any[] {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const results: any[] = [];
    try {
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  async addVocab(chunk_l2: string, capture_context_l2: string, anchor?: string): Promise<number | null> {
    const now = nowIso();
    this.db.run(
      `INSERT OR IGNORE INTO vocabulary_items (chunk_l2, capture_context_l2, anchor, first_seen_at) VALUES (?, ?, ?, ?)`,
      [chunk_l2.trim().toLowerCase(), capture_context_l2, anchor?.trim().toLowerCase() ?? null, now]
    );
    if (this.db.getRowsModified() === 0) return null;
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async listVocab(bucket: string, limit: number): Promise<ChunkItem[]> {
    if (bucket === "all") {
      return this.queryAll(`SELECT * FROM vocabulary_items ORDER BY id DESC LIMIT ?`, [limit]) as ChunkItem[];
    }
    const rows = this.queryAll(`SELECT * FROM vocabulary_items`) as ChunkItem[];
    const filtered = rows.filter((r) => statusOf(r.pro_reps, r.pro_stability) === bucket);
    return filtered.slice(0, limit);
  }

  async dueVocab(limit: number): Promise<DueChunkItem[]> {
    const now = nowIso();
    return this.queryAll(
      `SELECT id, chunk_l2, anchor, pro_stability, pro_reps, pro_due
       FROM vocabulary_items
       WHERE pro_due IS NULL OR pro_due <= ?
       ORDER BY pro_due ASC
       LIMIT ?`,
      [now, limit]
    ) as DueChunkItem[];
  }

  async scoreVocab(chunk_l2: string, grade: number, mode: "productive" | "receptive" = "productive"): Promise<FsrsReviewResult> {
    const g = Math.max(1, Math.min(3, Math.round(grade))) as Grade;
    const row = this.queryRow(
      `SELECT id, pro_stability, pro_difficulty, pro_reps, pro_last_review,
                rec_stability, rec_difficulty, rec_reps, rec_last_review
       FROM vocabulary_items WHERE chunk_l2 = ? COLLATE NOCASE`,
      [chunk_l2]
    ) as {
      id: number;
      pro_stability: number; pro_difficulty: number; pro_reps: number; pro_last_review: string | null;
      rec_stability: number; rec_difficulty: number; rec_reps: number; rec_last_review: string | null;
    } | undefined;

    if (!row) throw new Error(`Chunk not found: ${chunk_l2}`);

    const isProductive = mode === "productive";
    const stability = isProductive ? row.pro_stability : row.rec_stability;
    const difficulty = isProductive ? row.pro_difficulty : row.rec_difficulty;
    const reps = isProductive ? row.pro_reps : row.rec_reps;
    const lastReview = isProductive ? row.pro_last_review : row.rec_last_review;

    let result;
    if (reps === 0 || lastReview === null) {
      result = fsrsInitial(g);
    } else {
      const elapsed = computeElapsedDays(lastReview);
      result = fsrsReview({ stability, difficulty, reps }, g, elapsed);
    }

    const now = nowIso();
    const due = computeNextReview(result.due_days);

    if (isProductive) {
      this.db.run(
        `UPDATE vocabulary_items
         SET pro_stability = ?, pro_difficulty = ?, pro_reps = ?, pro_last_review = ?, pro_due = ?
         WHERE id = ?`,
        [result.stability, result.difficulty, result.reps, now, due, row.id]
      );
    } else {
      this.db.run(
        `UPDATE vocabulary_items
         SET rec_stability = ?, rec_difficulty = ?, rec_reps = ?, rec_last_review = ?, rec_due = ?
         WHERE id = ?`,
        [result.stability, result.difficulty, result.reps, now, due, row.id]
      );
    }
    this.save();

    return { stability: result.stability, difficulty: result.difficulty, reps: result.reps, status: result.status, due };
  }

  async logError(userText: string, correct: string, category: string, note: string): Promise<number> {
    const cat = normalizeCategory(category);
    this.db.run(
      `INSERT INTO error_log (user_text, correct_form, category, note) VALUES (?, ?, ?, ?)`,
      [userText, correct, cat, note]
    );
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async listErrors(category: string, limit: number): Promise<ErrorItem[]> {
    if (category === "all") {
      return this.queryAll(`SELECT * FROM error_log ORDER BY created_at DESC LIMIT ?`, [limit]) as ErrorItem[];
    }
    return this.queryAll(
      `SELECT * FROM error_log WHERE category = ? ORDER BY created_at DESC LIMIT ?`,
      [category, limit]
    ) as ErrorItem[];
  }

  async getProfile(): Promise<UserProfile | null> {
    const row = this.queryRow(`SELECT * FROM user_profile WHERE id = 1`);
    return (row ?? null) as UserProfile | null;
  }

  async setProfile(fields: Record<string, string>): Promise<string[]> {
    const validKeys = new Set([
      "name",
      "goal",
      "correction_style",
    ]);
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (validKeys.has(k)) filtered[k] = v;
    }

    this.db.run(
      `INSERT OR IGNORE INTO user_profile (id, started_at, updated_at) VALUES (1, ?, ?)`,
      [nowIso(), nowIso()]
    );
    this.save();

    if (Object.keys(filtered).length === 0) return [];

    const keys = Object.keys(filtered);
    const setClauses = keys.map((k) => `${k} = ?`).join(", ");
    const values = [...Object.values(filtered), nowIso()];
    this.db.run(
      `UPDATE user_profile SET ${setClauses}, updated_at = ? WHERE id = 1`,
      values
    );
    this.save();

    return keys;
  }

  async getConversationState(): Promise<ConversationStateResult> {
    const row = this.queryRow(
      `SELECT * FROM conversation_state ORDER BY id DESC LIMIT 1`
    ) as ConversationStateData | undefined;

    if (row) {
      const updatedAt = new Date(row.updated_at.replace(" ", "T"));
      const diffMin = (Date.now() - updatedAt.getTime()) / 60000;
      if (diffMin <= 30) {
        return { session: row, isNew: false };
      }
    }

    const sessionId = crypto.randomUUID();
    const now = nowIso();
    this.db.run(
      `INSERT INTO conversation_state (session_id, turn_count, last_two_modes, topics_touched, started_at, updated_at)
       VALUES (?, 0, '[]', '[]', ?, ?)`,
      [sessionId, now, now]
    );
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const newId = rowidResult[0].values[0][0];
    this.save();

    const newSession = this.queryRow(
      `SELECT * FROM conversation_state WHERE id = ?`,
      [newId]
    ) as ConversationStateData;
    return { session: newSession, isNew: true };
  }

  async updateConversationState(
    mode: string,
    topic?: string,
    mood?: string
  ): Promise<UpdateResult> {
    const { session } = await this.getConversationState();

    let lastTwo: string[] = JSON.parse(session.last_two_modes);
    lastTwo.push(mode);
    if (lastTwo.length > 2) lastTwo = lastTwo.slice(-2);

    let topics: string[] = JSON.parse(session.topics_touched);
    if (topic && !topics.includes(topic)) {
      topics.push(topic);
    }

    const now = nowIso();
    this.db.run(
      `UPDATE conversation_state
       SET turn_count = turn_count + 1,
           last_mode = ?,
           last_two_modes = ?,
           topics_touched = ?,
           mood_hint = COALESCE(?, mood_hint),
           updated_at = ?
       WHERE id = ?`,
      [mode, JSON.stringify(lastTwo), JSON.stringify(topics), mood ?? null, now, session.id]
    );
    this.save();

    const updated = this.queryRow(
      `SELECT * FROM conversation_state WHERE id = ?`,
      [session.id]
    ) as ConversationStateData;

    return {
      turn_count: updated.turn_count,
      last_two_modes: JSON.parse(updated.last_two_modes),
      topics_touched: JSON.parse(updated.topics_touched),
    };
  }

  async addInterest(interest: string, source: string, confidence: number): Promise<boolean> {
    const existing = this.queryRow(
      `SELECT id, confidence FROM user_interests WHERE interest = ? COLLATE NOCASE`,
      [interest]
    ) as { id: number; confidence: number } | undefined;

    if (existing) {
      const newConfidence = Math.max(existing.confidence, confidence);
      this.db.run(
        `UPDATE user_interests SET confidence = ?, source = ?, last_seen_at = ? WHERE id = ?`,
        [newConfidence, source, nowIso(), existing.id]
      );
      this.save();
      return false;
    }

    this.db.run(
      `INSERT INTO user_interests (interest, source, confidence) VALUES (?, ?, ?)`,
      [interest, source, confidence]
    );
    this.save();
    return true;
  }

  async listInterests(limit: number): Promise<string[]> {
    const rows = this.queryAll(
      `SELECT interest FROM user_interests ORDER BY last_seen_at DESC LIMIT ?`,
      [limit]
    ) as { interest: string }[];
    return rows.map((r) => r.interest);
  }

  async exportVocab(format: string): Promise<{ count: number; data: string }> {
    const rows = this.queryAll(`SELECT * FROM vocabulary_items ORDER BY id ASC`) as ChunkItem[];

    if (format === "csv") {
      const header = "chunk_l2,anchor,status,pro_stability,pro_reps,pro_due,rec_stability,rec_reps";
      const lines = rows.map((r) =>
        [
          r.chunk_l2,
          r.anchor ?? "",
          statusOf(r.pro_reps, r.pro_stability),
          r.pro_stability,
          r.pro_reps,
          r.pro_due ?? "",
          r.rec_stability,
          r.rec_reps,
        ].join(",")
      );
      return { count: rows.length, data: [header, ...lines].join("\n") };
    }

    const lines = rows.map((r) => {
      const s = statusOf(r.pro_reps, r.pro_stability);
      return `- **${r.chunk_l2}**${r.anchor ? ` [${r.anchor}]` : ""} — ${s}, S=${r.pro_stability}, due ${r.pro_due ?? "N/A"}`;
    });
    return { count: rows.length, data: lines.join("\n") };
  }

  async progressSummary(): Promise<ProgressData> {
    const rows = this.queryAll(`SELECT pro_reps, pro_stability FROM vocabulary_items`) as Pick<ChunkItem, "pro_reps" | "pro_stability">[];

    const now = nowIso();
    const dueRow = this.queryRow(
      `SELECT COUNT(*) AS c FROM vocabulary_items WHERE pro_due IS NULL OR pro_due <= ?`,
      [now]
    ) as { c: number };

    const recentRows = this.queryAll(
      `SELECT chunk_l2 FROM vocabulary_items ORDER BY first_seen_at DESC LIMIT 5`
    ) as { chunk_l2: string }[];

    const errorRows = this.queryAll(
      `SELECT category, COUNT(*) AS c FROM error_log GROUP BY category`
    ) as { category: string; c: number }[];

    const errorCategories: Record<string, number> = {};
    for (const e of errorRows) {
      errorCategories[e.category] = e.c;
    }

    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;
    let masteredCount = 0;

    for (const r of rows) {
      const s = statusOf(r.pro_reps, r.pro_stability);
      if (s === "new") newCount++;
      else if (s === "learning") learningCount++;
      else if (s === "review") reviewCount++;
      else if (s === "mastered") masteredCount++;
    }

    return {
      newCount,
      learningCount,
      reviewCount,
      masteredCount,
      totalCount: rows.length,
      dueCount: dueRow?.c ?? 0,
      recentWords: recentRows.map((r) => r.chunk_l2),
      errorCategories,
    };
  }

  async addChatMessage(chatId: number, role: string, content: string, sessionId?: string): Promise<void> {
    this.db.run(
      `INSERT INTO chat_history (chat_id, role, content, session_id) VALUES (?, ?, ?, ?)`,
      [chatId, role, content, sessionId ?? null]
    );
    this.save();
  }

  async getSessionTranscript(sessionId: string): Promise<{ role: string; content: string; created_at: string }[]> {
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE session_id = ? ORDER BY id ASC`,
      [sessionId]
    ) as { role: string; content: string; created_at: string }[];
  }

  async getChatHistory(chatId: number, limit: number): Promise<{ role: string; content: string }[]> {
    const rows = this.queryAll(
      `SELECT role, content FROM (
         SELECT id, role, content FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
      [chatId, limit]
    ) as { role: string; content: string }[];
    return rows;
  }

  async getTodaysMessages(date: string): Promise<{ role: string; content: string; created_at: string }[]> {
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE date(created_at) = ? ORDER BY id ASC`,
      [date]
    ) as { role: string; content: string; created_at: string }[];
  }

  // Returns a UTC ISO-ish string N seconds in the past, for comparing against
  // error_log.created_at which uses SQLite's datetime('now') (UTC).
  private static utcAgoIso(seconds: number): string {
    const d = new Date(Date.now() - seconds * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }

  private _updateVectorFromAnnotation(ann: TurnAnnotationInput, since: string): void {
    const DECAY = 0.85;
    const RECEPTION_ALPHA = 0.2;

    const vec = this.queryRow("SELECT * FROM competency_vector ORDER BY id DESC LIMIT 1") as CompetencyVectorRow | undefined;
    if (!vec) return;

    // 1. Decay
    let morphS = vec.morph_successes * DECAY;
    let morphT = vec.morph_trials * DECAY;
    let idiomS = vec.idiom_successes * DECAY;
    let idiomT = vec.idiom_trials * DECAY;
    let morphObs = vec.morph_obs;
    let idiomObs = vec.idiom_obs;

    // 2. Morphology (denominator from annotation, numerator from error_log)
    const morphObligatory = ann.obligatory.filter((o) => MORPHOLOGY_TYPES.has(o.type)).length;
    if (morphObligatory > 0) {
      const recentMorphErrors = this.queryAll(
        `SELECT id FROM error_log WHERE created_at >= ? AND category IN ('verb_conjugation','agreement','ser_estar','gender')`,
        [since]
      );
      morphT += morphObligatory;
      morphS += Math.max(0, morphObligatory - recentMorphErrors.length);
      morphObs++;
    }

    // 3. Idiomaticity (EWMA of naturalness score)
    if (ann.naturalness != null) {
      idiomT += 1;
      idiomS += ann.naturalness;
      idiomObs++;
    }

    // 4. Syntax rolling window (last 20 observations)
    const window: { tunit_length: number; had_sub: boolean }[] = JSON.parse(vec.syntax_window);
    window.push({ tunit_length: ann.tunit_length ?? 1, had_sub: ann.had_subordination ?? false });
    const trimmedWindow = window.slice(-20);

    // 5. Reception EWMA
    const signals: Record<string, number> = { smooth: 1.0, asked_clarify: 0.4, requested_simpler: 0.0 };
    const signal = signals[ann.comprehension] ?? 0.5;
    const recEwma = RECEPTION_ALPHA * signal + (1 - RECEPTION_ALPHA) * vec.reception_ewma;
    const recObs = vec.reception_obs + 1;

    this.db.run(
      `INSERT INTO competency_vector
        (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [morphS, morphT, morphObs, idiomS, idiomT, idiomObs, JSON.stringify(trimmedWindow), recEwma, recObs]
    );
  }

  async insertTurnAnnotation(ann: TurnAnnotationInput): Promise<void> {
    const since60s = BuddyDb.utcAgoIso(60);
    this.db.run(
      `INSERT INTO turn_annotations
        (session_id, turn_number, obligatory_json, used_json, naturalness, comprehension, tunit_length, had_subordination)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ann.session_id ?? null,
        ann.turn_number ?? null,
        JSON.stringify(ann.obligatory),
        JSON.stringify(ann.used),
        ann.naturalness ?? null,
        ann.comprehension,
        ann.tunit_length ?? 1,
        ann.had_subordination ? 1 : 0,
      ]
    );
    this._updateVectorFromAnnotation(ann, since60s);
    this.save();
  }

  async getRecentAnnotations(limit: number): Promise<TurnAnnotation[]> {
    return this.queryAll(
      `SELECT * FROM turn_annotations ORDER BY id DESC LIMIT ?`,
      [limit]
    ) as TurnAnnotation[];
  }

  async getCompetencyVector(): Promise<CompetencyVectorRow> {
    const row = this.queryRow(`SELECT * FROM competency_vector ORDER BY id DESC LIMIT 1`);
    if (!row) throw new Error("competency_vector not initialized");
    return row as CompetencyVectorRow;
  }

  async updateCompetencyVector(fields: Partial<Omit<CompetencyVectorRow, "id" | "created_at">>): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    const current = await this.getCompetencyVector();
    const merged = { ...current, ...fields };
    this.db.run(
      `INSERT INTO competency_vector
        (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [merged.morph_successes, merged.morph_trials, merged.morph_obs, merged.idiom_successes, merged.idiom_trials, merged.idiom_obs, merged.syntax_window, merged.reception_ewma, merged.reception_obs]
    );
    this.save();
  }

  async listRecentErrors(since: string, categories?: string[]): Promise<ErrorItem[]> {
    if (!categories || categories.length === 0) {
      return this.queryAll(
        `SELECT * FROM error_log WHERE created_at >= ? ORDER BY id ASC`,
        [since]
      ) as ErrorItem[];
    }
    const placeholders = categories.map(() => "?").join(",");
    return this.queryAll(
      `SELECT * FROM error_log WHERE created_at >= ? AND category IN (${placeholders}) ORDER BY id ASC`,
      [since, ...categories]
    ) as ErrorItem[];
  }

  close(): void {
    this.save();
  }
}
