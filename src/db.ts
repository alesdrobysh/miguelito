import Database from "better-sqlite3";
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
  db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  addVocab(word: string, translation: string, context: string): number | null {
    const now = nowIso();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO vocabulary_items (word, translation, context_first_seen, first_seen_at) VALUES (?, ?, ?, ?)`
    );
    const info = stmt.run(word, translation, context, now);
    if (info.changes === 0) return null;
    return info.lastInsertRowid as number;
  }

  listVocab(bucket: string, limit: number): VocabItem[] {
    if (bucket === "all") {
      const rows = this.db
        .prepare(`SELECT * FROM vocabulary_items ORDER BY id DESC LIMIT ?`)
        .all(limit) as VocabItem[];
      return rows;
    }
    const rows = this.db
      .prepare(`SELECT * FROM vocabulary_items`)
      .all() as VocabItem[];
    const filtered = rows.filter((r) => statusOf(r.repetitions, r.interval_days) === bucket);
    return filtered.slice(0, limit);
  }

  dueVocab(limit: number): DueVocabItem[] {
    const now = nowIso();
    const rows = this.db
      .prepare(
        `SELECT id, word, translation, status, repetitions, interval_days, ease_factor
         FROM vocabulary_items
         WHERE next_review_at IS NULL OR next_review_at <= ?
         ORDER BY next_review_at ASC
         LIMIT ?`
      )
      .all(now, limit) as DueVocabItem[];
    return rows;
  }

  scoreVocab(word: string, quality: number): Sm2Result {
    const row = this.db
      .prepare(
        `SELECT id, ease_factor, repetitions, interval_days FROM vocabulary_items WHERE word = ?`
      )
      .get(word) as { id: number; ease_factor: number; repetitions: number; interval_days: number } | undefined;

    if (!row) {
      throw new Error(`Vocabulary item not found: ${word}`);
    }

    const result = sm2Review(row.ease_factor, row.repetitions, row.interval_days, quality);
    const now = nowIso();
    const nextReview = computeNextReview(result.interval_days);

    this.db.prepare(
      `UPDATE vocabulary_items
       SET repetitions = ?, interval_days = ?, ease_factor = ?, status = ?,
           last_reviewed_at = ?, next_review_at = ?
       WHERE id = ?`
    ).run(result.repetitions, result.interval_days, result.ease_factor, result.status, now, nextReview, row.id);

    return {
      repetitions: result.repetitions,
      interval_days: result.interval_days,
      ease_factor: result.ease_factor,
      status: result.status,
      next_review_at: nextReview,
    };
  }

  logError(userText: string, correct: string, category: string, note: string): number {
    const cat = normalizeCategory(category);
    const stmt = this.db.prepare(
      `INSERT INTO error_log (user_text, correct_form, category, note) VALUES (?, ?, ?, ?)`
    );
    const info = stmt.run(userText, correct, cat, note);
    return info.lastInsertRowid as number;
  }

  listErrors(category: string, limit: number): ErrorItem[] {
    if (category === "all") {
      return this.db
        .prepare(`SELECT * FROM error_log ORDER BY created_at DESC LIMIT ?`)
        .all(limit) as ErrorItem[];
    }
    return this.db
      .prepare(
        `SELECT * FROM error_log WHERE category = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(category, limit) as ErrorItem[];
  }

  getProfile(): UserProfile | null {
    const row = this.db
      .prepare(`SELECT * FROM user_profile WHERE id = 1`)
      .get();
    return (row ?? null) as UserProfile | null;
  }

  setProfile(fields: Record<string, string>): string[] {
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

    this.db.prepare(
      `INSERT OR IGNORE INTO user_profile (id, started_at, updated_at) VALUES (1, ?, ?)`
    ).run(nowIso(), nowIso());

    if (Object.keys(filtered).length === 0) return [];

    const setClauses = Object.keys(filtered)
      .map((k) => `${k} = @${k}`)
      .join(", ");
    const updateStmt = this.db.prepare(
      `UPDATE user_profile SET ${setClauses}, updated_at = ? WHERE id = 1`
    );
    updateStmt.run({ ...filtered }, nowIso());

    return Object.keys(filtered);
  }

  getConversationState(): ConversationStateResult {
    const row = this.db
      .prepare(
        `SELECT * FROM conversation_state ORDER BY id DESC LIMIT 1`
      )
      .get() as ConversationStateData | undefined;

    if (row) {
      const updatedAt = new Date(row.updated_at.replace(" ", "T"));
      const diffMin = (Date.now() - updatedAt.getTime()) / 60000;
      if (diffMin <= 30) {
        return { session: row, isNew: false };
      }
    }

    const sessionId = crypto.randomUUID();
    const now = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO conversation_state (session_id, turn_count, corrections_this_session, last_two_modes, topics_touched, started_at, updated_at)
       VALUES (?, 0, 0, '[]', '[]', ?, ?)`
    );
    const info = stmt.run(sessionId, now, now);
    const newSession = this.db
      .prepare(`SELECT * FROM conversation_state WHERE id = ?`)
      .get(info.lastInsertRowid) as ConversationStateData;
    return { session: newSession, isNew: true };
  }

  updateConversationState(
    mode: string,
    topic?: string,
    mood?: string
  ): UpdateResult {
    const { session } = this.getConversationState();

    let lastTwo: string[] = JSON.parse(session.last_two_modes);
    lastTwo.push(mode);
    if (lastTwo.length > 2) lastTwo = lastTwo.slice(-2);

    let topics: string[] = JSON.parse(session.topics_touched);
    if (topic && !topics.includes(topic)) {
      topics.push(topic);
    }

    const now = nowIso();
    this.db.prepare(
      `UPDATE conversation_state
       SET turn_count = turn_count + 1,
           last_mode = ?,
           last_two_modes = ?,
           topics_touched = ?,
           mood_hint = COALESCE(?, mood_hint),
           updated_at = ?
       WHERE id = ?`
    ).run(mode, JSON.stringify(lastTwo), JSON.stringify(topics), mood ?? null, now, session.id);

    const updated = this.db
      .prepare(`SELECT * FROM conversation_state WHERE id = ?`)
      .get(session.id) as ConversationStateData;

    return {
      turn_count: updated.turn_count,
      corrections_this_session: updated.corrections_this_session,
      last_two_modes: JSON.parse(updated.last_two_modes),
      topics_touched: JSON.parse(updated.topics_touched),
    };
  }

  addInterest(interest: string, source: string, confidence: number): boolean {
    const existing = this.db
      .prepare(`SELECT id, confidence FROM user_interests WHERE interest = ? COLLATE NOCASE`)
      .get(interest) as { id: number; confidence: number } | undefined;

    if (existing) {
      const newConfidence = Math.max(existing.confidence, confidence);
      this.db.prepare(
        `UPDATE user_interests SET confidence = ?, source = ?, last_seen_at = ? WHERE id = ?`
      ).run(newConfidence, source, nowIso(), existing.id);
      return false;
    }

    this.db.prepare(
      `INSERT INTO user_interests (interest, source, confidence) VALUES (?, ?, ?)`
    ).run(interest, source, confidence);
    return true;
  }

  listInterests(limit: number): string[] {
    const rows = this.db
      .prepare(`SELECT interest FROM user_interests ORDER BY last_seen_at DESC LIMIT ?`)
      .all(limit) as { interest: string }[];
    return rows.map((r) => r.interest);
  }

  insertAssessment(
    cefrLevel: string,
    confidence: number | null,
    weakAreas: string | null,
    wordsToWeave: string | null,
    errorToReinforce: string | null,
    strengths: string | null,
    sampleCount: number | null
  ): number {
    const stmt = this.db.prepare(
      `INSERT INTO learner_assessments (cefr_level, confidence, weak_areas, words_to_weave, error_to_reinforce, strengths, sample_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      cefrLevel,
      confidence,
      weakAreas,
      wordsToWeave,
      errorToReinforce,
      strengths,
      sampleCount
    );
    return info.lastInsertRowid as number;
  }

  getLatestAssessment(): Record<string, unknown> | null {
    const row = this.db
      .prepare(`SELECT * FROM learner_assessments ORDER BY id DESC LIMIT 1`)
      .get();
    return (row ?? null) as Record<string, unknown> | null;
  }

  exportVocab(format: string): { count: number; data: string } {
    const rows = this.db
      .prepare(`SELECT * FROM vocabulary_items ORDER BY id ASC`)
      .all() as VocabItem[];

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

  progressSummary(): ProgressData {
    const rows = this.db
      .prepare(`SELECT * FROM vocabulary_items`)
      .all() as VocabItem[];

    const now = nowIso();
    const dueCount = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM vocabulary_items WHERE next_review_at IS NULL OR next_review_at <= ?`
      )
      .get(now) as { c: number };

    const recentRows = this.db
      .prepare(
        `SELECT word FROM vocabulary_items ORDER BY first_seen_at DESC LIMIT 5`
      )
      .all() as { word: string }[];

    const errorRows = this.db
      .prepare(`SELECT category, COUNT(*) AS c FROM error_log GROUP BY category`)
      .all() as { category: string; c: number }[];

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
      dueCount: dueCount.c,
      recentWords: recentRows.map((r) => r.word),
      errorCategories,
    };
  }

  close(): void {
    this.db.close();
  }
}