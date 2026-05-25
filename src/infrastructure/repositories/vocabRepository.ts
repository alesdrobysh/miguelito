import type { Database } from "sql.js";
import { fsrsInitial, fsrsReview, statusOf, Grade } from "../../domain/fsrs.js";
import type {
  ChunkItem,
  DueChunkItem,
  FsrsReviewResult,
  ProgressData,
  VocabReviewMode,
  VocabReviewAttempt,
  StartVocabReviewAttemptInput,
  FinishVocabReviewAttemptInput,
  VocabCandidateItem,
} from "../../domain/types.js";
import type { VocabRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn, nowIso, computeNextReview, computeElapsedDays } from "./sqlRepository.js";

export class SqlVocabRepository extends SqlRepository implements VocabRepository {
  constructor(db: Database, languageId: string, save: SaveFn) {
    super(db, languageId, save);
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
}
