import type { Database } from "sql.js";
import type { LearningItem, LearningItemEvidenceInput, LearningItemEvidenceRow, LearningItemInput, LearningItemStatus, LearningItemType, LearningPracticeAttempt, StartLearningPracticeAttemptInput, FinishLearningPracticeAttemptInput } from "../../domain/types.js";
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
const VALID_STATUSES = new Set(["candidate", "active", "cooling_down", "stable", "ignored", "mastered", "archived"]);
const VALID_EVIDENCE_SKILLS = new Set(["passive", "active", "reactivation"]);

function clamp01(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function nextReactivationDate(activeScore: number, passiveScore: number): string {
  const score = Math.max(activeScore, passiveScore);
  const days = score >= 0.85 ? 30 : score >= 0.65 ? 14 : score >= 0.35 ? 7 : 2;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function stabilityFor(activeScore: number, passiveScore: number, evidenceCount: number): string {
  const score = Math.max(activeScore, passiveScore);
  if (evidenceCount <= 0) return "new";
  if (activeScore >= 0.8 && passiveScore >= 0.7) return "stable";
  if (score >= 0.2) return "developing";
  return "noticed";
}

function pressureFor(activeScore: number, passiveScore: number): string {
  const score = Math.max(activeScore, passiveScore);
  return score >= 0.7 ? "low" : score >= 0.35 ? "medium" : "high";
}

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

  async listDueLearningItems(limit: number): Promise<LearningItem[]> {
    const capped = Math.max(1, Math.min(20, Math.round(limit || 5)));
    return this.queryAll<LearningItem>(
      `SELECT * FROM learning_items
       WHERE language = ?
         AND status IN ('active', 'cooling_down')
         AND (next_reactivation_at IS NULL OR next_reactivation_at <= datetime('now'))
       ORDER BY priority DESC, evidence_count ASC, created_at ASC, id ASC
       LIMIT ?`,
      [this.languageId, capped],
    );
  }

  async recordLearningItemEvidence(input: LearningItemEvidenceInput): Promise<number> {
    const itemId = Number(input.learning_item_id);
    const item = this.queryRow<LearningItem>(`SELECT * FROM learning_items WHERE id = ? AND language = ?`, [itemId, this.languageId]);
    if (!item) throw new Error(`Learning item #${itemId} not found`);
    const rawSkill = String(input.skill ?? "passive").trim().toLowerCase();
    const skill = VALID_EVIDENCE_SKILLS.has(rawSkill) ? rawSkill : "passive";
    const event = String(input.event ?? "").trim();
    if (!event) throw new Error("Learning item evidence event is required");
    const independence = String(input.independence ?? "unknown").trim().toLowerCase() || "unknown";
    const deltaRaw = Number(input.score_delta ?? 0);
    const scoreDelta = Number.isFinite(deltaRaw) ? Math.max(-1, Math.min(1, deltaRaw)) : 0;
    const confidence = clamp01(input.confidence, 0.5);
    const now = nowIso();
    const sourceType = String(input.source_type ?? "conversation").trim() || "conversation";
    this.db.run(
      `INSERT INTO learning_item_evidence
       (learning_item_id, language, skill, event, independence, score_delta, confidence, evidence_snippet, source_type, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemId, this.languageId, skill, event, independence, scoreDelta, confidence, input.evidence_snippet?.trim() || null, sourceType, input.source_message_id ?? null, now],
    );
    const evidenceId = this.db.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;

    const passiveScore = clamp01(Number(item.passive_score ?? 0) + (skill === "passive" ? scoreDelta : 0), 0);
    const activeScore = clamp01(Number(item.active_score ?? 0) + (skill === "active" ? scoreDelta : 0), 0);
    const evidenceCount = Number(item.evidence_count ?? 0) + 1;
    const failureCount = Number(item.failure_count ?? 0) + (scoreDelta < 0 ? 1 : 0);
    const avoidanceCount = Number(item.avoidance_count ?? 0) + (event === "avoidance" ? 1 : 0);
    const lastUnderstoodAt = skill === "passive" && scoreDelta > 0 ? now : item.last_understood_at;
    const lastProducedAt = skill === "active" && scoreDelta > 0 ? now : item.last_produced_at;
    const lastReactivatedAt = skill === "reactivation" ? now : item.last_reactivated_at;
    const stability = stabilityFor(activeScore, passiveScore, evidenceCount);
    const status = stability === "stable" ? "stable" : item.status === "stable" ? "cooling_down" : item.status;
    this.db.run(
      `UPDATE learning_items
       SET passive_score = ?, active_score = ?, stability = ?, last_seen_at = ?, last_understood_at = ?, last_produced_at = ?,
           last_reactivated_at = ?, next_reactivation_at = ?, reactivation_pressure = ?, evidence_count = ?, failure_count = ?, avoidance_count = ?,
           status = ?, updated_at = ?
       WHERE id = ? AND language = ?`,
      [passiveScore, activeScore, stability, now, lastUnderstoodAt, lastProducedAt, lastReactivatedAt, nextReactivationDate(activeScore, passiveScore), pressureFor(activeScore, passiveScore), evidenceCount, failureCount, avoidanceCount, status, now, itemId, this.languageId],
    );
    this.save();
    return evidenceId;
  }

  async listLearningItemEvidence(learningItemId: number, limit = 20): Promise<LearningItemEvidenceRow[]> {
    const capped = Math.max(1, Math.min(100, Math.round(limit || 20)));
    return this.queryAll<LearningItemEvidenceRow>(
      `SELECT * FROM learning_item_evidence WHERE language = ? AND learning_item_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [this.languageId, learningItemId, capped],
    );
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
