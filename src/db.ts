import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { sm2Review, statusOf } from "./sm2.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vocabulary_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    translation TEXT,
    context_first_seen TEXT,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_reviewed_at DATETIME,
    next_review_at DATETIME,
    status TEXT DEFAULT 'new',
    ease_factor REAL DEFAULT 2.5,
    repetitions INTEGER DEFAULT 0,
    interval_days INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vocab_next_review ON vocabulary_items(next_review_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_word_unique ON vocabulary_items(word COLLATE NOCASE);

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
    native_language TEXT,
    level TEXT,
    goal TEXT,
    correction_style TEXT,
    interests TEXT,
    setup_step TEXT,
    started_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _buddy_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learner_assessments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    cefr_level        TEXT NOT NULL,
    confidence        REAL,
    weak_areas        TEXT,
    words_to_weave    TEXT,
    error_to_reinforce TEXT,
    strengths         TEXT,
    sample_count      INTEGER,
    assessed_at       DATETIME DEFAULT CURRENT_TIMESTAMP
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
    corrections_this_session Integer DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id);
`;

const VALID_CATEGORIES = new Set([
  "gender",
  "verb_conjugation",
  "preposition",
  "spelling",
  "word_choice",
  "agreement",
  "ser_estar",
  "por_para",
  "other",
]);

export interface VocabItem {
  id: number;
  word: string;
  translation: string | null;
  context_first_seen: string | null;
  first_seen_at: string | null;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  status: string;
  ease_factor: number;
  repetitions: number;
  interval_days: number;
}

export interface DueVocabItem {
  id: number;
  word: string;
  translation: string | null;
  status: string;
  repetitions: number;
  interval_days: number;
  ease_factor: number;
  next_review_at: string | null;
}

export interface ErrorItem {
  id: number;
  user_text: string;
  correct_form: string;
  category: string;
  note: string | null;
  created_at: string;
}

export interface UserProfile {
  id: number;
  name: string | null;
  native_language: string | null;
  level: string | null;
  goal: string | null;
  correction_style: string | null;
  interests: string | null;
  setup_step: string | null;
  started_at: string | null;
  updated_at: string;
}

export interface ConversationStateData {
  id: number;
  session_id: string;
  turn_count: number;
  corrections_this_session: number;
  last_mode: string | null;
  last_two_modes: string;
  topics_touched: string;
  mood_hint: string | null;
  started_at: string;
  updated_at: string;
}

export interface ConversationStateResult {
  session: ConversationStateData;
  isNew: boolean;
}

export interface Sm2Result {
  repetitions: number;
  interval_days: number;
  ease_factor: number;
  status: string;
  next_review_at: string;
}

export interface ProgressData {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  masteredCount: number;
  totalCount: number;
  dueCount: number;
  recentWords: string[];
  errorCategories: Record<string, number>;
}

export interface UpdateResult {
  turn_count: number;
  corrections_this_session: number;
  last_two_modes: string[];
  topics_touched: string[];
}

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

function normalizeCategory(category: string): string {
  if (VALID_CATEGORIES.has(category)) return category;
  return "other";
}

export class BuddyDb {
  readonly db: Database;
  private dbPath: string;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  private static runMigrations(db: Database): void {
    const info = db.exec("PRAGMA table_info(chat_history)");
    const cols = (info[0]?.values ?? []).map((r) => r[1] as string);
    if (!cols.includes("session_id")) {
      db.run("ALTER TABLE chat_history ADD COLUMN session_id TEXT");
      db.run("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id)");
    }
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

  async addVocab(word: string, translation: string, context: string): Promise<number | null> {
    const now = nowIso();
    this.db.run(
      `INSERT OR IGNORE INTO vocabulary_items (word, translation, context_first_seen, first_seen_at) VALUES (?, ?, ?, ?)`,
      [word, translation, context, now]
    );
    if (this.db.getRowsModified() === 0) return null;
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async listVocab(bucket: string, limit: number): Promise<VocabItem[]> {
    if (bucket === "all") {
      return this.queryAll(`SELECT * FROM vocabulary_items ORDER BY id DESC LIMIT ?`, [limit]) as VocabItem[];
    }
    const rows = this.queryAll(`SELECT * FROM vocabulary_items`) as VocabItem[];
    const filtered = rows.filter((r: VocabItem) => statusOf(r.repetitions, r.interval_days) === bucket);
    return filtered.slice(0, limit);
  }

  async dueVocab(limit: number): Promise<DueVocabItem[]> {
    const now = nowIso();
    return this.queryAll(
      `SELECT id, word, translation, status, repetitions, interval_days, ease_factor
       FROM vocabulary_items
       WHERE next_review_at IS NULL OR next_review_at <= ?
       ORDER BY next_review_at ASC
       LIMIT ?`,
      [now, limit]
    ) as DueVocabItem[];
  }

  async scoreVocab(word: string, quality: number): Promise<Sm2Result> {
    const row = this.queryRow(
      `SELECT id, ease_factor, repetitions, interval_days FROM vocabulary_items WHERE word = ?`,
      [word]
    ) as { id: number; ease_factor: number; repetitions: number; interval_days: number } | undefined;

    if (!row) {
      throw new Error(`Vocabulary item not found: ${word}`);
    }

    const result = sm2Review(row.ease_factor, row.repetitions, row.interval_days, quality);
    const now = nowIso();
    const nextReview = computeNextReview(result.interval_days);

    this.db.run(
      `UPDATE vocabulary_items
       SET repetitions = ?, interval_days = ?, ease_factor = ?, status = ?,
           last_reviewed_at = ?, next_review_at = ?
       WHERE id = ?`,
      [result.repetitions, result.interval_days, result.ease_factor, result.status, now, nextReview, row.id]
    );
    this.save();

    return {
      repetitions: result.repetitions,
      interval_days: result.interval_days,
      ease_factor: result.ease_factor,
      status: result.status,
      next_review_at: nextReview,
    };
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
      "native_language",
      "level",
      "goal",
      "correction_style",
      "interests",
      "setup_step",
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
      `INSERT INTO conversation_state (session_id, turn_count, corrections_this_session, last_two_modes, topics_touched, started_at, updated_at)
       VALUES (?, 0, 0, '[]', '[]', ?, ?)`,
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
      corrections_this_session: updated.corrections_this_session,
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

  async insertAssessment(
    cefrLevel: string,
    confidence: number | null,
    weakAreas: string | null,
    wordsToWeave: string | null,
    errorToReinforce: string | null,
    strengths: string | null,
    sampleCount: number | null
  ): Promise<number> {
    this.db.run(
      `INSERT INTO learner_assessments (cefr_level, confidence, weak_areas, words_to_weave, error_to_reinforce, strengths, sample_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cefrLevel, confidence, weakAreas, wordsToWeave, errorToReinforce, strengths, sampleCount]
    );
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async getLatestAssessment(): Promise<Record<string, unknown> | null> {
    const row = this.queryRow(`SELECT * FROM learner_assessments ORDER BY id DESC LIMIT 1`);
    return (row ?? null) as Record<string, unknown> | null;
  }

  async exportVocab(format: string): Promise<{ count: number; data: string }> {
    const rows = this.queryAll(`SELECT * FROM vocabulary_items ORDER BY id ASC`) as VocabItem[];

    if (format === "csv") {
      const header = "word,translation,status,repetitions,interval_days,ease_factor,next_review_at";
      const lines = rows.map((r) =>
        [
          r.word,
          r.translation ?? "",
          statusOf(r.repetitions, r.interval_days),
          r.repetitions,
          r.interval_days,
          r.ease_factor,
          r.next_review_at ?? "",
        ].join(",")
      );
      return { count: rows.length, data: [header, ...lines].join("\n") };
    }

    const lines = rows.map((r) => {
      const s = statusOf(r.repetitions, r.interval_days);
      return `- **${r.word}** (${r.translation ?? ""}) — ${s}, ease ${r.ease_factor}, next ${r.next_review_at ?? "N/A"}`;
    });
    return { count: rows.length, data: lines.join("\n") };
  }

  async progressSummary(): Promise<ProgressData> {
    const rows = this.queryAll(`SELECT * FROM vocabulary_items`) as VocabItem[];

    const now = nowIso();
    const dueRow = this.queryRow(
      `SELECT COUNT(*) AS c FROM vocabulary_items WHERE next_review_at IS NULL OR next_review_at <= ?`,
      [now]
    ) as { c: number };

    const recentRows = this.queryAll(
      `SELECT word FROM vocabulary_items ORDER BY first_seen_at DESC LIMIT 5`
    ) as { word: string }[];

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
      const s = statusOf(r.repetitions, r.interval_days);
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
      recentWords: recentRows.map((r) => r.word),
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

  close(): void {
    this.save();
  }
}
