import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { fsrsInitial, fsrsReview, statusOf, Grade } from "../domain/fsrs.js";
import type {
  ChunkItem, DueChunkItem, ErrorItem, UserProfile, ConversationStateData,
  ConversationStateResult, FsrsReviewResult, ProgressData, UpdateResult,
  TurnAnnotationInput, TurnAnnotation, CompetencyVectorRow,
  VocabReviewMode, VocabReviewAttempt, StartVocabReviewAttemptInput, FinishVocabReviewAttemptInput,
  VocabCandidateItem,
  ProficiencyEvidenceInput, ProficiencyEvidenceRow,
} from "../domain/types.js";
import type {
  VocabRepository, ErrorRepository, SessionRepository, ProfileRepository,
  InterestRepository, CompetencyRepository,
} from "../repositories/interfaces.js";

import { SCHEMA } from "./schema.js";
import { runMigrations } from "./migrations.js";

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

export class BuddyDb implements VocabRepository, ErrorRepository, SessionRepository, ProfileRepository, InterestRepository, CompetencyRepository {
  readonly db: Database;
  private dbPath: string;
  private languageId: string;
  private validCategories: ReadonlySet<string>;
  private morphologyTypes: ReadonlySet<string>;

  private constructor(
    db: Database,
    dbPath: string,
    languageId: string,
    validCategories: readonly string[],
    morphologyCategories: readonly string[],
  ) {
    this.db = db;
    this.dbPath = dbPath;
    this.languageId = languageId;
    this.validCategories = new Set(validCategories);
    this.morphologyTypes = new Set(morphologyCategories);
  }

  withLanguage(languageId: string, errorCategories: readonly string[], morphologyCategories: readonly string[]): BuddyDb {
    return new BuddyDb(this.db, this.dbPath, languageId, errorCategories, morphologyCategories);
  }

  static async open(
    dbPath: string,
    languageId: string,
    errorCategories: readonly string[],
    morphologyCategories: readonly string[],
  ): Promise<BuddyDb> {
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
    runMigrations(db);
    return new BuddyDb(db, dbPath, languageId, errorCategories, morphologyCategories);
  }

  private normalizeCategory(category: string): string {
    if (this.validCategories.has(category)) return category;
    return "other";
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
      `INSERT OR IGNORE INTO vocabulary_items (chunk_l2, capture_context_l2, anchor, language, first_seen_at, status) VALUES (?, ?, ?, ?, ?, 'active')`,
      [chunk_l2.trim().toLowerCase(), capture_context_l2, anchor?.trim().toLowerCase() ?? null, this.languageId, now]
    );
    if (this.db.getRowsModified() === 0) return null;
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async addVocabCandidate(input: {
    chunk_l2: string;
    anchor?: string;
    meaning_l1?: string;
    capture_context_l2?: string;
    source_type?: string;
    source_message_id?: number;
    evidence_snippet?: string;
    proposed_by?: string;
    priority?: number;
    topic_tags?: string[];
    acceptable_variants?: string[];
    elicitation_cues?: string[];
    promotion_reason?: string;
  }): Promise<number | null> {
    const chunk = input.chunk_l2.trim().toLowerCase();
    if (!chunk) return null;
    const active = this.queryRow(
      `SELECT id FROM vocabulary_items WHERE language = ? AND chunk_l2 = ? COLLATE NOCASE`,
      [this.languageId, chunk]
    );
    if (active) return null;
    this.db.run(
      `INSERT OR IGNORE INTO vocabulary_candidates
       (chunk_l2, anchor, meaning_l1, capture_context_l2, language, source_type, source_message_id,
        evidence_snippet, proposed_by, priority, status, topic_tags_json, acceptable_variants_json,
        elicitation_cues_json, promotion_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?)`,
      [
        chunk,
        input.anchor?.trim().toLowerCase() || null,
        input.meaning_l1?.trim() || null,
        input.capture_context_l2?.trim() || null,
        this.languageId,
        input.source_type?.trim() || "conversation",
        input.source_message_id ?? null,
        input.evidence_snippet?.trim() || null,
        input.proposed_by?.trim() || "evaluator",
        Math.max(0, Math.min(1, Number(input.priority ?? 0.5) || 0.5)),
        JSON.stringify(input.topic_tags ?? []),
        JSON.stringify(input.acceptable_variants ?? []),
        JSON.stringify(input.elicitation_cues ?? []),
        input.promotion_reason?.trim() || null,
      ]
    );
    if (this.db.getRowsModified() === 0) return null;
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async listVocabCandidates(status: string, limit: number): Promise<VocabCandidateItem[]> {
    const capped = Math.max(1, Math.min(200, Math.round(limit || 50)));
    if (status === "all") {
      return this.queryAll(
        `SELECT * FROM vocabulary_candidates WHERE language = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        [this.languageId, capped]
      ) as VocabCandidateItem[];
    }
    return this.queryAll(
      `SELECT * FROM vocabulary_candidates WHERE language = ? AND status = ? ORDER BY priority DESC, created_at ASC LIMIT ?`,
      [this.languageId, status, capped]
    ) as VocabCandidateItem[];
  }

  async promoteVocabCandidates(options: { maxPromotions?: number; minPriority?: number; maxActiveLearningItems?: number } = {}): Promise<ChunkItem[]> {
    const maxPromotions = Math.max(0, Math.min(10, Math.round(options.maxPromotions ?? 2)));
    const minPriority = Math.max(0, Math.min(1, Number(options.minPriority ?? 0.75) || 0.75));
    const maxActiveLearningItems = Math.max(0, Math.round(options.maxActiveLearningItems ?? 40));
    const activeLearning = this.queryRow(
      `SELECT COUNT(*) AS count FROM vocabulary_items WHERE language = ? AND status = 'active' AND pro_reps < 3`,
      [this.languageId]
    ) as { count: number };
    let room = Math.max(0, maxActiveLearningItems - Number(activeLearning?.count ?? 0));
    const limit = Math.min(maxPromotions, room);
    if (limit <= 0) return [];
    const candidates = this.queryAll(
      `SELECT * FROM vocabulary_candidates
       WHERE language = ? AND status = 'candidate' AND priority >= ?
       ORDER BY priority DESC, created_at ASC, id ASC
       LIMIT ?`,
      [this.languageId, minPriority, limit]
    ) as VocabCandidateItem[];
    const promoted: ChunkItem[] = [];
    for (const c of candidates) {
      if (room <= 0) break;
      const id = await this.addVocab(c.chunk_l2, c.capture_context_l2 ?? "", c.anchor ?? undefined);
      const vocabId = id ?? (this.queryRow(
        `SELECT id FROM vocabulary_items WHERE language = ? AND chunk_l2 = ? COLLATE NOCASE`,
        [this.languageId, c.chunk_l2]
      ) as { id: number } | undefined)?.id;
      if (!vocabId) continue;
      this.db.run(
        `UPDATE vocabulary_items
         SET source_type = ?, source_candidate_id = ?, meaning_l1 = ?, topic_tags_json = ?,
             acceptable_variants_json = ?, elicitation_cues_json = ?, promotion_reason = ?
         WHERE id = ?`,
        [c.source_type, c.id, c.meaning_l1, c.topic_tags_json, c.acceptable_variants_json, c.elicitation_cues_json, c.promotion_reason, vocabId]
      );
      this.db.run(`UPDATE vocabulary_candidates SET status = 'accepted', reviewed_at = ? WHERE id = ?`, [nowIso(), c.id]);
      const row = this.queryRow(`SELECT * FROM vocabulary_items WHERE id = ?`, [vocabId]) as ChunkItem;
      promoted.push(row);
      room--;
    }
    this.save();
    return promoted;
  }

  async promoteSpecificVocabCandidate(candidateId: number): Promise<ChunkItem | null> {
    const c = this.queryRow(
      `SELECT * FROM vocabulary_candidates WHERE language = ? AND id = ? AND status = 'candidate'`,
      [this.languageId, candidateId]
    ) as VocabCandidateItem | undefined;
    if (!c) return null;
    const id = await this.addVocab(c.chunk_l2, c.capture_context_l2 ?? "", c.anchor ?? undefined);
    const vocabId = id ?? (this.queryRow(
      `SELECT id FROM vocabulary_items WHERE language = ? AND chunk_l2 = ? COLLATE NOCASE`,
      [this.languageId, c.chunk_l2]
    ) as { id: number } | undefined)?.id;
    if (!vocabId) return null;
    this.db.run(
      `UPDATE vocabulary_items
       SET source_type = ?, source_candidate_id = ?, meaning_l1 = ?, topic_tags_json = ?,
           acceptable_variants_json = ?, elicitation_cues_json = ?, promotion_reason = ?
       WHERE id = ?`,
      [c.source_type, c.id, c.meaning_l1, c.topic_tags_json, c.acceptable_variants_json, c.elicitation_cues_json, c.promotion_reason, vocabId]
    );
    this.db.run(`UPDATE vocabulary_candidates SET status = 'accepted', reviewed_at = ? WHERE id = ?`, [nowIso(), c.id]);
    this.save();
    return this.queryRow(`SELECT * FROM vocabulary_items WHERE id = ?`, [vocabId]) as ChunkItem;
  }

  async updateVocabCandidateStatus(candidateId: number, status: string): Promise<boolean> {
    const normalized = ["candidate", "accepted", "rejected", "merged"].includes(status) ? status : "rejected";
    this.db.run(
      `UPDATE vocabulary_candidates SET status = ?, reviewed_at = ? WHERE language = ? AND id = ?`,
      [normalized, nowIso(), this.languageId, candidateId]
    );
    const changed = this.db.getRowsModified() > 0;
    if (changed) this.save();
    return changed;
  }

  async listVocab(bucket: string, limit: number): Promise<ChunkItem[]> {
    if (bucket === "all") {
      return this.queryAll(`SELECT * FROM vocabulary_items WHERE language = ? AND status = 'active' ORDER BY id DESC LIMIT ?`, [this.languageId, limit]) as ChunkItem[];
    }
    const rows = this.queryAll(`SELECT * FROM vocabulary_items WHERE language = ? AND status = 'active'`, [this.languageId]) as ChunkItem[];
    const filtered = rows.filter((r) => statusOf(r.pro_reps, r.pro_stability) === bucket);
    return filtered.slice(0, limit);
  }

  async dueVocab(limit: number, mode: VocabReviewMode = "productive"): Promise<DueChunkItem[]> {
    const now = nowIso();
    const prefix = mode === "receptive" ? "rec" : "pro";
    return this.queryAll(
      `SELECT id, chunk_l2, anchor,
              ${prefix}_stability AS pro_stability,
              ${prefix}_reps AS pro_reps,
              ${prefix}_due AS pro_due
       FROM vocabulary_items
       WHERE language = ? AND status = 'active' AND (${prefix}_due IS NULL OR ${prefix}_due <= ?)
       ORDER BY ${prefix}_due ASC
       LIMIT ?`,
      [this.languageId, now, limit]
    ) as DueChunkItem[];
  }

  async scoreVocab(chunk_l2: string, grade: number, mode: "productive" | "receptive" = "productive"): Promise<FsrsReviewResult> {
    const g = Math.max(1, Math.min(3, Math.round(grade))) as Grade;
    const row = this.queryRow(
      `SELECT id, pro_stability, pro_difficulty, pro_reps, pro_last_review,
                rec_stability, rec_difficulty, rec_reps, rec_last_review
       FROM vocabulary_items WHERE chunk_l2 = ? COLLATE NOCASE AND language = ?`,
      [chunk_l2, this.languageId]
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

  async startVocabReviewAttempt(input: StartVocabReviewAttemptInput): Promise<VocabReviewAttempt> {
    const word = input.word.trim().toLowerCase();
    const mode: VocabReviewMode = input.mode === "receptive" ? "receptive" : "productive";
    const row = this.queryRow(
      `SELECT id, chunk_l2 FROM vocabulary_items WHERE chunk_l2 = ? COLLATE NOCASE AND language = ?`,
      [word, this.languageId]
    ) as { id: number; chunk_l2: string } | undefined;
    if (!row) throw new Error(`Chunk not found: ${word}`);

    this.db.run(
      `INSERT INTO vocab_review_attempts
        (vocab_id, word, language, mode, status, strategy, prompt_text, hint_level)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        row.id,
        row.chunk_l2,
        this.languageId,
        mode,
        input.strategy?.trim() || null,
        input.prompt_text?.trim() || null,
        Math.max(0, Math.round(input.hint_level ?? 0)),
      ]
    );
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return this.getVocabReviewAttempt(id);
  }

  async finishVocabReviewAttempt(input: FinishVocabReviewAttemptInput): Promise<VocabReviewAttempt> {
    const existing = this.getVocabReviewAttempt(input.attempt_id);
    const grade = Math.max(1, Math.min(3, Math.round(input.grade))) as Grade;
    const now = nowIso();
    this.db.run(
      `UPDATE vocab_review_attempts
       SET status = 'completed', user_response = ?, target_used = ?, accepted_variant = ?,
           hint_level = ?, grade = ?, note = ?, completed_at = ?
       WHERE id = ? AND language = ?`,
      [
        input.user_response?.trim() || null,
        input.target_used ? 1 : 0,
        input.accepted_variant?.trim() || null,
        Math.max(0, Math.round(input.hint_level ?? existing.hint_level)),
        grade,
        input.note?.trim() || null,
        now,
        input.attempt_id,
        this.languageId,
      ]
    );
    await this.scoreVocab(existing.word, grade, existing.mode);
    this.save();
    return this.getVocabReviewAttempt(input.attempt_id);
  }

  private getVocabReviewAttempt(id: number): VocabReviewAttempt {
    const row = this.queryRow(
      `SELECT * FROM vocab_review_attempts WHERE id = ? AND language = ?`,
      [id, this.languageId]
    ) as VocabReviewAttempt | undefined;
    if (!row) throw new Error(`Review attempt not found: ${id}`);
    return row;
  }

  async logError(userText: string, correct: string, category: string, note: string): Promise<number> {
    const cat = this.normalizeCategory(category);
    this.db.run(
      `INSERT INTO error_log (user_text, correct_form, category, language, note) VALUES (?, ?, ?, ?, ?)`,
      [userText, correct, cat, this.languageId, note]
    );
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async listErrors(category: string, limit: number): Promise<ErrorItem[]> {
    if (category === "all") {
      return this.queryAll(`SELECT * FROM error_log WHERE language = ? ORDER BY created_at DESC LIMIT ?`, [this.languageId, limit]) as ErrorItem[];
    }
    return this.queryAll(
      `SELECT * FROM error_log WHERE language = ? AND category = ? ORDER BY created_at DESC LIMIT ?`,
      [this.languageId, category, limit]
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
      `SELECT * FROM conversation_state WHERE language = ? ORDER BY id DESC LIMIT 1`,
      [this.languageId]
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
      `INSERT INTO conversation_state (session_id, turn_count, last_two_modes, topics_touched, language, started_at, updated_at)
       VALUES (?, 0, '[]', '[]', ?, ?, ?)`,
      [sessionId, this.languageId, now, now]
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
    const rows = this.queryAll(`SELECT * FROM vocabulary_items WHERE language = ? ORDER BY id ASC`, [this.languageId]) as ChunkItem[];

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
    const rows = this.queryAll(`SELECT pro_reps, pro_stability FROM vocabulary_items WHERE language = ?`, [this.languageId]) as Pick<ChunkItem, "pro_reps" | "pro_stability">[];

    const now = nowIso();
    const dueRow = this.queryRow(
      `SELECT COUNT(*) AS c FROM vocabulary_items WHERE language = ? AND (pro_due IS NULL OR pro_due <= ?)`,
      [this.languageId, now]
    ) as { c: number };

    const recentRows = this.queryAll(
      `SELECT chunk_l2 FROM vocabulary_items WHERE language = ? ORDER BY first_seen_at DESC LIMIT 5`,
      [this.languageId]
    ) as { chunk_l2: string }[];

    const errorRows = this.queryAll(
      `SELECT category, COUNT(*) AS c FROM error_log WHERE language = ? GROUP BY category`,
      [this.languageId]
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
      `INSERT INTO chat_history (chat_id, role, content, session_id, language) VALUES (?, ?, ?, ?, ?)`,
      [chatId, role, content, sessionId ?? null, this.languageId]
    );
    this.save();
  }

  async getSessionTranscript(sessionId: string, limit?: number): Promise<{ role: string; content: string; created_at: string }[]> {
    if (limit && limit > 0) {
      return this.queryAll(
        `SELECT role, content, created_at FROM (
           SELECT id, role, content, created_at FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
        [sessionId, limit]
      ) as { role: string; content: string; created_at: string }[];
    }
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE session_id = ? ORDER BY id ASC`,
      [sessionId]
    ) as { role: string; content: string; created_at: string }[];
  }

  async getChatHistory(chatId: number, limit?: number): Promise<{ role: string; content: string }[]> {
    if (limit && limit > 0) {
      return this.queryAll(
        `SELECT role, content FROM (
           SELECT id, role, content FROM chat_history WHERE chat_id = ? AND language = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
        [chatId, this.languageId, limit]
      ) as { role: string; content: string }[];
    }
    return this.queryAll(
      `SELECT role, content FROM chat_history WHERE chat_id = ? AND language = ? ORDER BY id ASC`,
      [chatId, this.languageId]
    ) as { role: string; content: string }[];
  }

  async getTodaysMessages(date: string): Promise<{ role: string; content: string; created_at: string }[]> {
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE date(created_at) = ? AND language = ? ORDER BY id ASC`,
      [date, this.languageId]
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
    const RARITY_ALPHA = 0.15;

    const vec = this.queryRow("SELECT * FROM competency_vector WHERE language = ? ORDER BY id DESC LIMIT 1", [this.languageId]) as CompetencyVectorRow | undefined;
    if (!vec) return;

    // 1. Decay
    let morphS = vec.morph_successes * DECAY;
    let morphT = vec.morph_trials * DECAY;
    let idiomS = vec.idiom_successes * DECAY;
    let idiomT = vec.idiom_trials * DECAY;
    let morphObs = vec.morph_obs;
    let idiomObs = vec.idiom_obs;

    // 2. Morphology (denominator from annotation, numerator from error_log)
    const morphObligatory = ann.obligatory.filter((o) => this.morphologyTypes.has(o.type)).length;
    if (morphObligatory > 0) {
      const morphCats = Array.from(this.morphologyTypes);
      const placeholders = morphCats.map(() => "?").join(",");
      const recentMorphErrors = this.queryAll(
        `SELECT id FROM error_log WHERE language = ? AND created_at >= ? AND category IN (${placeholders})`,
        [this.languageId, since, ...morphCats]
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

    // 6. Lexical Rarity EWMA
    const raritySignal = ann.lexical_rarity ?? 0.0;
    const rarityEwma = RARITY_ALPHA * raritySignal + (1 - RARITY_ALPHA) * vec.lexical_rarity_ewma;

    // 7. Self-Correction Counter
    const selfCorrectionObs = vec.self_correction_obs + (ann.self_correction ? 1 : 0);

    this.db.run(
      `INSERT INTO competency_vector
        (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs, lexical_rarity_ewma, self_correction_obs, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [morphS, morphT, morphObs, idiomS, idiomT, idiomObs, JSON.stringify(trimmedWindow), recEwma, recObs, rarityEwma, selfCorrectionObs, this.languageId]
    );
  }

  async insertTurnAnnotation(ann: TurnAnnotationInput): Promise<void> {
    const since60s = BuddyDb.utcAgoIso(60);
    this.db.run(
      `INSERT INTO turn_annotations
        (session_id, turn_number, obligatory_json, used_json, naturalness, comprehension, tunit_length, had_subordination, lexical_rarity, self_correction, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ann.session_id ?? null,
        ann.turn_number ?? null,
        JSON.stringify(ann.obligatory),
        JSON.stringify(ann.used),
        ann.naturalness ?? null,
        ann.comprehension,
        ann.tunit_length ?? 1,
        ann.had_subordination ? 1 : 0,
        ann.lexical_rarity ?? 0.0,
        ann.self_correction ? 1 : 0,
        this.languageId,
      ]
    );
    this._updateVectorFromAnnotation(ann, since60s);
    this.save();
  }

  async getRecentAnnotations(limit: number): Promise<TurnAnnotation[]> {
    return this.queryAll(
      `SELECT * FROM turn_annotations WHERE language = ? ORDER BY id DESC LIMIT ?`,
      [this.languageId, limit]
    ) as TurnAnnotation[];
  }

  async getCompetencyVector(): Promise<CompetencyVectorRow> {
    let row = this.queryRow(`SELECT * FROM competency_vector WHERE language = ? ORDER BY id DESC LIMIT 1`, [this.languageId]);
    if (!row) {
      this.db.run("INSERT INTO competency_vector (language) VALUES (?)", [this.languageId]);
      this.save();
      row = this.queryRow(`SELECT * FROM competency_vector WHERE language = ? ORDER BY id DESC LIMIT 1`, [this.languageId]);
    }
    return row as CompetencyVectorRow;
  }

  async updateCompetencyVector(fields: Partial<Omit<CompetencyVectorRow, "id" | "created_at">>): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    const current = await this.getCompetencyVector();
    const merged = { ...current, ...fields };
    this.db.run(
      `INSERT INTO competency_vector
        (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [merged.morph_successes, merged.morph_trials, merged.morph_obs, merged.idiom_successes, merged.idiom_trials, merged.idiom_obs, merged.syntax_window, merged.reception_ewma, merged.reception_obs, this.languageId]
    );
    this.save();
  }

  async listRecentErrors(since: string, categories?: string[]): Promise<ErrorItem[]> {
    if (!categories || categories.length === 0) {
      return this.queryAll(
        `SELECT * FROM error_log WHERE language = ? AND created_at >= ? ORDER BY id ASC`,
        [this.languageId, since]
      ) as ErrorItem[];
    }
    const placeholders = categories.map(() => "?").join(",");
    return this.queryAll(
      `SELECT * FROM error_log WHERE language = ? AND created_at >= ? AND category IN (${placeholders}) ORDER BY id ASC`,
      [this.languageId, since, ...categories]
    ) as ErrorItem[];
  }

  async insertProficiencyEvidence(evidence: ProficiencyEvidenceInput): Promise<number> {
    this.db.run(
      `INSERT INTO proficiency_evidence
        (language, skill, dimension, level, outcome, confidence, weight, evidence_text, challenge_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.languageId,
        evidence.skill,
        evidence.dimension,
        evidence.level,
        evidence.outcome,
        Math.max(0, Math.min(1, evidence.confidence)),
        Math.max(0, evidence.weight),
        evidence.evidence_text,
        evidence.challenge_json ?? "{}",
      ]
    );
    const id = this.queryRow("SELECT last_insert_rowid() AS id") as { id: number };
    this.save();
    return id.id;
  }

  async listProficiencyEvidence(limit: number): Promise<ProficiencyEvidenceRow[]> {
    return this.queryAll(
      `SELECT * FROM proficiency_evidence WHERE language = ? ORDER BY id DESC LIMIT ?`,
      [this.languageId, limit]
    ) as ProficiencyEvidenceRow[];
  }

  close(): void {
    this.save();
  }
}
