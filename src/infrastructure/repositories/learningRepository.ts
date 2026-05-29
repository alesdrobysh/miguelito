import type { Database } from "sql.js";
import type { LearningItem, LearningItemInput, LearningItemStatus, LearningItemType, LearningPracticeAttempt, StartLearningPracticeAttemptInput, FinishLearningPracticeAttemptInput } from "../../domain/types.js";
import { SqlRepository, type SaveFn, nowIso, computeNextReview } from "./sqlRepository.js";

const VALID_TYPES = new Set([
  "word",
  "phrase",
  "correction",
  "grammar_point",
  "collocation",
  "idiom",
  "register_note",
  "pronunciation",
]);
const VALID_STATUSES = new Set(["candidate", "active", "ignored", "mastered"]);

export class SqlLearningRepository extends SqlRepository {
  constructor(db: Database, languageId: string, save: SaveFn) {
    super(db, languageId, save);
  }

  async addLearningItem(input: LearningItemInput): Promise<number | null> {
    const title = String(input.title ?? "").trim();
    if (!title) return null;
    const rawType = String(input.type ?? "phrase").trim().toLowerCase();
    const type = (VALID_TYPES.has(rawType) ? rawType : "phrase") as LearningItemType;
    const rawStatus = String(input.status ?? "active").trim().toLowerCase();
    const status = (VALID_STATUSES.has(rawStatus) ? rawStatus : "active") as LearningItemStatus;
    const now = nowIso();
    this.db.run(
      `INSERT OR IGNORE INTO learning_items
       (language, type, title, prompt_l2, explanation_l1, source_type, source_message_id, evidence_snippet,
        priority, status, practice_modes_json, tags_json, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.languageId,
        type,
        title,
        input.prompt_l2?.trim() || null,
        input.explanation_l1?.trim() || null,
        input.source_type?.trim() || "conversation",
        input.source_message_id ?? null,
        input.evidence_snippet?.trim() || null,
        Math.max(0, Math.min(1, Number(input.priority ?? 0.5) || 0.5)),
        status,
        JSON.stringify(input.practice_modes ?? []),
        JSON.stringify(input.tags ?? []),
        input.due_at?.trim() || null,
        now,
        now,
      ],
    );
    if (this.db.getRowsModified() === 0) return null;
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const id = rowidResult[0].values[0][0] as number;
    this.save();
    return id;
  }

  async listLearningItems(status: string, limit: number): Promise<LearningItem[]> {
    const capped = Math.max(1, Math.min(200, Math.round(limit || 50)));
    if (status === "all") {
      return this.queryAll(
        `SELECT * FROM learning_items WHERE language = ? ORDER BY priority DESC, created_at ASC, id ASC LIMIT ?`,
        [this.languageId, capped],
      ) as LearningItem[];
    }
    return this.queryAll(
      `SELECT * FROM learning_items WHERE language = ? AND status = ? ORDER BY priority DESC, created_at ASC, id ASC LIMIT ?`,
      [this.languageId, status, capped],
    ) as LearningItem[];
  }

  async startLearningPracticeAttempt(input: StartLearningPracticeAttemptInput): Promise<LearningPracticeAttempt> {
    const itemId = Number(input.learning_item_id);
    const item = this.queryRow<LearningItem>(`SELECT * FROM learning_items WHERE id = ? AND language = ?`, [itemId, this.languageId]);
    if (!item) throw new Error(`Learning item #${itemId} not found`);
    const active = this.queryRow<LearningPracticeAttempt>(
      `SELECT * FROM learning_practice_attempts WHERE learning_item_id = ? AND language = ? AND status = 'active' ORDER BY id ASC LIMIT 1`,
      [itemId, this.languageId],
    );
    if (active) return active;
    this.db.run(
      `INSERT INTO learning_practice_attempts (learning_item_id, language, status, prompt_text, created_at) VALUES (?, ?, 'active', ?, ?)`,
      [itemId, this.languageId, input.prompt_text?.trim() || null, nowIso()],
    );
    const id = this.db.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;
    this.save();
    return this.queryRow<LearningPracticeAttempt>(`SELECT * FROM learning_practice_attempts WHERE id = ?`, [id])!;
  }

  async listActiveLearningPracticeAttempts(limit = 10): Promise<LearningPracticeAttempt[]> {
    const capped = Math.max(1, Math.min(50, Math.round(limit || 10)));
    return this.queryAll<LearningPracticeAttempt>(
      `SELECT * FROM learning_practice_attempts WHERE language = ? AND status = 'active' ORDER BY created_at ASC, id ASC LIMIT ?`,
      [this.languageId, capped],
    );
  }

  async finishLearningPracticeAttempt(input: FinishLearningPracticeAttemptInput): Promise<LearningPracticeAttempt> {
    const attempt = this.queryRow<LearningPracticeAttempt>(
      `SELECT * FROM learning_practice_attempts WHERE id = ? AND language = ? AND status = 'active'`,
      [input.attempt_id, this.languageId],
    );
    if (!attempt) throw new Error(`Active learning practice attempt #${input.attempt_id} not found`);
    const now = nowIso();
    const grade = Math.max(1, Math.min(4, Math.round(Number(input.grade) || 1)));
    const intervalDays = grade >= 4 ? 7 : grade >= 3 ? 3 : grade >= 2 ? 1 : 0;
    const dueAt = computeNextReview(intervalDays);
    this.db.run(
      `UPDATE learning_practice_attempts
       SET status = 'completed', user_response = ?, grade = ?, note = ?, completed_at = ?
       WHERE id = ? AND language = ?`,
      [input.user_response.trim(), grade, input.note?.trim() || null, now, attempt.id, this.languageId],
    );
    this.db.run(
      `UPDATE learning_items
       SET reps = reps + 1, last_practiced_at = ?, due_at = ?, updated_at = ?
       WHERE id = ? AND language = ?`,
      [now, dueAt, now, attempt.learning_item_id, this.languageId],
    );
    this.save();
    return this.queryRow<LearningPracticeAttempt>(`SELECT * FROM learning_practice_attempts WHERE id = ?`, [attempt.id])!;
  }

  async abandonActiveLearningPracticeAttempts(note = "practice stopped"): Promise<number> {
    const now = nowIso();
    this.db.run(
      `UPDATE learning_practice_attempts
       SET status = 'abandoned', note = ?, completed_at = ?
       WHERE language = ? AND status = 'active'`,
      [note.trim() || "practice stopped", now, this.languageId],
    );
    const changed = this.db.getRowsModified();
    if (changed > 0) this.save();
    return changed;
  }
}
