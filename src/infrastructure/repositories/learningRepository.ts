import type { Database } from "sql.js";
import type { LearningItem, LearningItemEvidenceInput, LearningItemEvidenceRow, LearningItemInput, LearningItemStatus, LearningItemType, LearningPracticeAttempt, StartLearningPracticeAttemptInput, FinishLearningPracticeAttemptInput, FuzzyLearningItemDuplicateCandidate, FuzzyLearningItemDuplicateOptions, FuzzyLearningItemDuplicateDecision, AppliedFuzzyLearningItemMerge } from "../../domain/types.js";
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
  const days = score >= 0.85 ? 14 : score >= 0.65 ? 7 : score >= 0.35 ? 3 : 1;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function initialReactivationDate(priority: number): string {
  const d = new Date();
  const hours = priority >= 0.9 ? 2 : priority >= 0.7 ? 8 : 18;
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function afterReintroductionDate(activeScore: number, passiveScore: number): string {
  const score = Math.max(activeScore, passiveScore);
  const d = new Date();
  d.setHours(d.getHours() + (score >= 0.35 ? 24 : 12));
  return d.toISOString();
}

function tokenizeForMatching(text: string): string[] {
  const stop = new Set(["que", "con", "para", "por", "del", "las", "los", "una", "uno", "este", "esta", "como", "pero", "mas", "más", "the", "and"]);
  return Array.from(new Set(text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[\p{L}\p{N}]{4,}/gu) ?? []))
    .filter((t) => !stop.has(t))
    .slice(0, 12);
}


function canonicalLearningItemKey(type: string, title: string): string {
  const normalizedTitle = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:"'`´()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Corrections encode a specific before→after contrast; keep them separate
  // from phrase/word/collocation captures. Vocabulary-like items with the same
  // title are one learning target even if the evaluator alternates word/phrase.
  return type === "correction" ? `correction:${normalizedTitle}` : `lexical:${normalizedTitle}`;
}

function normalizeFuzzyText(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:"'`´()[\]{}→/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinSimilarity(a: unknown, b: unknown): number {
  const left = normalizeFuzzyText(a);
  const right = normalizeFuzzyText(b);
  const n = left.length;
  const m = right.length;
  if (n === 0 && m === 0) return 1;
  if (n === 0 || m === 0) return 0;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let cur = new Array<number>(m + 1);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - (prev[m] / Math.max(n, m));
}

function tokenJaccard(a: unknown, b: unknown): number {
  const tokens = (value: unknown) => new Set(normalizeFuzzyText(value).split(" ").filter((t) => t.length >= 4));
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  const union = new Set([...left, ...right]);
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / Math.max(1, union.size);
}

function isSameLearningObjectiveCandidate(a: LearningItem, b: LearningItem): boolean {
  if (a.type === b.type) return true;
  const lexical = new Set(["word", "phrase", "collocation", "idiom"]);
  return lexical.has(String(a.type)) && lexical.has(String(b.type));
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
    const priority = Math.max(0, Math.min(1, Number(input.priority ?? 0.5) || 0.5));
    const existing = this.findDuplicateLearningItem(type, title);
    if (existing) {
      const next = initialReactivationDate(priority);
      this.db.run(
        `UPDATE learning_items
         SET priority = MAX(priority, ?),
             status = CASE WHEN status IN ('ignored', 'archived', 'mastered') THEN status ELSE 'active' END,
             prompt_l2 = COALESCE(NULLIF(prompt_l2, ''), ?),
             explanation_l1 = COALESCE(NULLIF(explanation_l1, ''), ?),
             evidence_snippet = COALESCE(NULLIF(evidence_snippet, ''), ?),
             next_reactivation_at = CASE
               WHEN next_reactivation_at IS NULL OR datetime(next_reactivation_at) > datetime(?) THEN ?
               ELSE next_reactivation_at
             END,
             reactivation_pressure = CASE WHEN reactivation_pressure = 'low' THEN 'medium' ELSE reactivation_pressure END,
             updated_at = ?
         WHERE id = ? AND language = ?`,
        [priority, input.prompt_l2?.trim() || null, input.explanation_l1?.trim() || null, input.evidence_snippet?.trim() || null, next, next, now, existing.id, this.languageId],
      );
      if (this.db.getRowsModified() > 0) this.save();
      return existing.id;
    }
    this.db.run(
      `INSERT OR IGNORE INTO learning_items
       (language, type, title, prompt_l2, explanation_l1, source_type, source_message_id, evidence_snippet,
        priority, status, practice_modes_json, tags_json, due_at, next_reactivation_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.languageId,
        type,
        title,
        input.prompt_l2?.trim() || null,
        input.explanation_l1?.trim() || null,
        input.source_type?.trim() || "conversation",
        input.source_message_id ?? null,
        input.evidence_snippet?.trim() || null,
        priority,
        status,
        JSON.stringify(input.practice_modes ?? []),
        JSON.stringify(input.tags ?? []),
        input.due_at?.trim() || null,
        initialReactivationDate(priority),
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

  private findDuplicateLearningItem(type: string, title: string): LearningItem | null {
    const key = canonicalLearningItemKey(type, title);
    const candidates = this.queryAll<LearningItem>(
      `SELECT * FROM learning_items
       WHERE language = ? AND status NOT IN ('ignored', 'archived', 'mastered')
       ORDER BY evidence_count DESC, priority DESC, datetime(updated_at) DESC, id ASC
       LIMIT 500`,
      [this.languageId],
    );
    return candidates.find((item) => canonicalLearningItemKey(String(item.type), item.title) === key) ?? null;
  }

  async deduplicateLearningItems(limit = 500): Promise<number> {
    const capped = Math.max(1, Math.min(5000, Math.round(limit || 500)));
    const items = this.queryAll<LearningItem>(
      `SELECT * FROM learning_items
       WHERE language = ? AND status NOT IN ('ignored', 'archived', 'mastered')
       ORDER BY datetime(created_at) ASC, id ASC
       LIMIT ?`,
      [this.languageId, capped],
    );
    const groups = new Map<string, LearningItem[]>();
    for (const item of items) {
      const key = canonicalLearningItemKey(String(item.type), item.title);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    let changed = 0;
    const now = nowIso();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [keeper, ...duplicates] = group.sort((a, b) => {
        const aRank = Number(a.evidence_count ?? 0) * 10 + Number(a.active_score ?? 0) * 4 + Number(a.passive_score ?? 0) * 2 + Number(a.priority ?? 0);
        const bRank = Number(b.evidence_count ?? 0) * 10 + Number(b.active_score ?? 0) * 4 + Number(b.passive_score ?? 0) * 2 + Number(b.priority ?? 0);
        return bRank - aRank || a.id - b.id;
      });
      for (const dup of duplicates) {
        this.db.run(`UPDATE learning_item_evidence SET learning_item_id = ? WHERE language = ? AND learning_item_id = ?`, [keeper.id, this.languageId, dup.id]);
        this.db.run(`UPDATE learning_practice_attempts SET learning_item_id = ? WHERE language = ? AND learning_item_id = ?`, [keeper.id, this.languageId, dup.id]);
        const passiveScore = clamp01(Math.max(Number(keeper.passive_score ?? 0), Number(dup.passive_score ?? 0)));
        const activeScore = clamp01(Math.max(Number(keeper.active_score ?? 0), Number(dup.active_score ?? 0)));
        const evidenceCount = this.queryRow<{ count: number }>(`SELECT COUNT(*) AS count FROM learning_item_evidence WHERE language = ? AND learning_item_id = ?`, [this.languageId, keeper.id])?.count ?? (Number(keeper.evidence_count ?? 0) + Number(dup.evidence_count ?? 0));
        const failureCount = Number(keeper.failure_count ?? 0) + Number(dup.failure_count ?? 0);
        const avoidanceCount = Number(keeper.avoidance_count ?? 0) + Number(dup.avoidance_count ?? 0);
        const stability = stabilityFor(activeScore, passiveScore, evidenceCount);
        const status = stability === "stable" ? "stable" : keeper.status;
        this.db.run(
          `UPDATE learning_items
           SET priority = MAX(priority, ?), passive_score = ?, active_score = ?, stability = ?,
               evidence_count = ?, failure_count = ?, avoidance_count = ?, status = ?,
               prompt_l2 = COALESCE(NULLIF(prompt_l2, ''), ?),
               explanation_l1 = COALESCE(NULLIF(explanation_l1, ''), ?),
               evidence_snippet = COALESCE(NULLIF(evidence_snippet, ''), ?),
               last_seen_at = COALESCE(last_seen_at, ?),
               last_reactivated_at = COALESCE(last_reactivated_at, ?),
               last_understood_at = COALESCE(last_understood_at, ?),
               last_produced_at = COALESCE(last_produced_at, ?),
               next_reactivation_at = CASE
                 WHEN next_reactivation_at IS NULL THEN ?
                 WHEN ? IS NULL THEN next_reactivation_at
                 WHEN datetime(?) < datetime(next_reactivation_at) THEN ?
                 ELSE next_reactivation_at
               END,
               reactivation_pressure = ?, updated_at = ?
           WHERE id = ? AND language = ?`,
          [Number(dup.priority ?? 0), passiveScore, activeScore, stability, evidenceCount, failureCount, avoidanceCount, status, dup.prompt_l2, dup.explanation_l1, dup.evidence_snippet, dup.last_seen_at, dup.last_reactivated_at, dup.last_understood_at, dup.last_produced_at, dup.next_reactivation_at, dup.next_reactivation_at, dup.next_reactivation_at, dup.next_reactivation_at, pressureFor(activeScore, passiveScore), now, keeper.id, this.languageId],
        );
        this.db.run(
          `UPDATE learning_items SET status = 'archived', updated_at = ? WHERE id = ? AND language = ?`,
          [now, dup.id, this.languageId],
        );
        changed++;
      }
    }
    if (changed > 0) this.save();
    return changed;
  }

  async findFuzzyLearningItemDuplicateCandidates(options: FuzzyLearningItemDuplicateOptions = {}): Promise<FuzzyLearningItemDuplicateCandidate[]> {
    const scanLimit = Math.max(2, Math.min(5000, Math.round(options.scanLimit ?? 1000)));
    const limit = Math.max(1, Math.min(200, Math.round(options.limit ?? 50)));
    const items = this.queryAll<LearningItem>(
      `SELECT * FROM learning_items
       WHERE language = ? AND status NOT IN ('ignored', 'archived', 'mastered')
       ORDER BY datetime(created_at) ASC, id ASC
       LIMIT ?`,
      [this.languageId, scanLimit],
    );
    const candidates: FuzzyLearningItemDuplicateCandidate[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const itemA = items[i];
        const itemB = items[j];
        if (!isSameLearningObjectiveCandidate(itemA, itemB)) continue;
        const titleSimilarity = levenshteinSimilarity(itemA.title, itemB.title);
        const promptSimilarity = levenshteinSimilarity(itemA.prompt_l2, itemB.prompt_l2);
        const explanationSimilarity = levenshteinSimilarity(itemA.explanation_l1, itemB.explanation_l1);
        const textA = [itemA.title, itemA.prompt_l2, itemA.explanation_l1].filter(Boolean).join(" ");
        const textB = [itemB.title, itemB.prompt_l2, itemB.explanation_l1].filter(Boolean).join(" ");
        const tokenSimilarity = tokenJaccard(textA, textB);
        const rawSignals = [
          { name: "title", value: titleSimilarity, threshold: String(itemA.type) === "correction" ? 0.52 : 0.68 },
          { name: "prompt", value: promptSimilarity, threshold: String(itemA.type) === "correction" ? 0.78 : 0.88 },
          { name: "explanation", value: explanationSimilarity, threshold: 0.78 },
          { name: "tokens", value: tokenSimilarity, threshold: 0.58 },
        ];
        const titleOverlap = titleSimilarity >= 0.45;
        const strongTitleOrPrompt = titleOverlap || promptSimilarity >= 0.45;
        const promptIsEnough = promptSimilarity >= (String(itemA.type) === "correction" ? 0.78 : 0.88) && (String(itemA.type) === "correction" ? strongTitleOrPrompt : titleOverlap);
        const titleIsEnough = titleSimilarity >= (String(itemA.type) === "correction" ? 0.52 : 0.68);
        const semanticIsEnough = strongTitleOrPrompt && (explanationSimilarity >= 0.78 || tokenSimilarity >= 0.58);
        if (!titleIsEnough && !promptIsEnough && !semanticIsEnough) continue;
        const signals = rawSignals.filter((signal) => signal.value >= signal.threshold);
        const score = Math.max(titleSimilarity, promptSimilarity, explanationSimilarity, tokenSimilarity);
        const reason = signals
          .sort((a, b) => b.value - a.value)
          .map((signal) => `${signal.name} similarity ${signal.value.toFixed(2)}`)
          .join("; ");
        candidates.push({
          itemA,
          itemB,
          score: Number(score.toFixed(3)),
          titleSimilarity: Number(titleSimilarity.toFixed(3)),
          promptSimilarity: Number(promptSimilarity.toFixed(3)),
          explanationSimilarity: Number(explanationSimilarity.toFixed(3)),
          tokenSimilarity: Number(tokenSimilarity.toFixed(3)),
          reason,
        });
      }
    }
    return candidates.sort((a, b) => b.score - a.score || a.itemA.id - b.itemA.id || a.itemB.id - b.itemB.id).slice(0, limit);
  }

  async applyFuzzyLearningItemMerge(decision: FuzzyLearningItemDuplicateDecision): Promise<AppliedFuzzyLearningItemMerge | null> {
    if (decision.decision !== "merge") return null;
    const ids = [Number(decision.itemAId), Number(decision.itemBId)];
    const keeperId = Number(decision.keeperId);
    if (!ids.every(Number.isFinite) || !ids.includes(keeperId)) return null;
    const archivedId = ids.find((id) => id !== keeperId)!;
    const keeper = this.queryRow<LearningItem>(
      `SELECT * FROM learning_items WHERE language = ? AND id = ? AND status NOT IN ('ignored', 'archived', 'mastered')`,
      [this.languageId, keeperId],
    );
    const dup = this.queryRow<LearningItem>(
      `SELECT * FROM learning_items WHERE language = ? AND id = ? AND status NOT IN ('ignored', 'archived', 'mastered')`,
      [this.languageId, archivedId],
    );
    if (!keeper || !dup) return null;
    const now = nowIso();
    this.db.run(`UPDATE learning_item_evidence SET learning_item_id = ? WHERE language = ? AND learning_item_id = ?`, [keeper.id, this.languageId, dup.id]);
    this.db.run(`UPDATE learning_practice_attempts SET learning_item_id = ? WHERE language = ? AND learning_item_id = ?`, [keeper.id, this.languageId, dup.id]);
    const passiveScore = clamp01(Math.max(Number(keeper.passive_score ?? 0), Number(dup.passive_score ?? 0)));
    const activeScore = clamp01(Math.max(Number(keeper.active_score ?? 0), Number(dup.active_score ?? 0)));
    const evidenceCount = this.queryRow<{ count: number }>(`SELECT COUNT(*) AS count FROM learning_item_evidence WHERE language = ? AND learning_item_id = ?`, [this.languageId, keeper.id])?.count ?? (Number(keeper.evidence_count ?? 0) + Number(dup.evidence_count ?? 0));
    const failureCount = Number(keeper.failure_count ?? 0) + Number(dup.failure_count ?? 0);
    const avoidanceCount = Number(keeper.avoidance_count ?? 0) + Number(dup.avoidance_count ?? 0);
    const stability = stabilityFor(activeScore, passiveScore, evidenceCount);
    const status = stability === "stable" ? "stable" : keeper.status;
    this.db.run(
      `UPDATE learning_items
       SET title = COALESCE(NULLIF(?, ''), title),
           priority = MAX(priority, ?), passive_score = ?, active_score = ?, stability = ?,
           evidence_count = ?, failure_count = ?, avoidance_count = ?, status = ?,
           prompt_l2 = COALESCE(NULLIF(?, ''), NULLIF(prompt_l2, ''), ?),
           explanation_l1 = COALESCE(NULLIF(?, ''), NULLIF(explanation_l1, ''), ?),
           evidence_snippet = COALESCE(NULLIF(evidence_snippet, ''), ?),
           last_seen_at = COALESCE(last_seen_at, ?),
           last_reactivated_at = COALESCE(last_reactivated_at, ?),
           last_understood_at = COALESCE(last_understood_at, ?),
           last_produced_at = COALESCE(last_produced_at, ?),
           next_reactivation_at = CASE
             WHEN next_reactivation_at IS NULL THEN ?
             WHEN ? IS NULL THEN next_reactivation_at
             WHEN datetime(?) < datetime(next_reactivation_at) THEN ?
             ELSE next_reactivation_at
           END,
           reactivation_pressure = ?, updated_at = ?
       WHERE id = ? AND language = ?`,
      [
        decision.mergedTitle?.trim() || null,
        Number(dup.priority ?? 0),
        passiveScore,
        activeScore,
        stability,
        evidenceCount,
        failureCount,
        avoidanceCount,
        status,
        decision.mergedPromptL2?.trim() || null,
        dup.prompt_l2,
        decision.mergedExplanationL1?.trim() || null,
        dup.explanation_l1,
        dup.evidence_snippet,
        dup.last_seen_at,
        dup.last_reactivated_at,
        dup.last_understood_at,
        dup.last_produced_at,
        dup.next_reactivation_at,
        dup.next_reactivation_at,
        dup.next_reactivation_at,
        dup.next_reactivation_at,
        pressureFor(activeScore, passiveScore),
        now,
        keeper.id,
        this.languageId,
      ],
    );
    this.db.run(
      `UPDATE learning_items SET status = 'archived', updated_at = ? WHERE id = ? AND language = ?`,
      [now, dup.id, this.languageId],
    );
    this.save();
    return { keeperId: keeper.id, archivedId: dup.id };
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
         AND (next_reactivation_at IS NULL OR datetime(next_reactivation_at) <= datetime('now'))
       ORDER BY
         CASE reactivation_pressure WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
         datetime(COALESCE(next_reactivation_at, created_at)) ASC,
         evidence_count ASC,
         datetime(updated_at) ASC,
         id ASC
       LIMIT ?`,
      [this.languageId, capped],
    );
  }

  async selectLearningItemsForEvaluation(userMessage: string, assistantText: string, limit: number): Promise<LearningItem[]> {
    const capped = Math.max(1, Math.min(100, Math.round(limit || 60)));
    const selected = new Map<number, LearningItem>();
    const add = (items: LearningItem[]) => {
      for (const item of items) {
        if (selected.size >= capped) break;
        selected.set(item.id, item);
      }
    };

    const text = `${userMessage} ${assistantText}`;
    const tokens = tokenizeForMatching(text);
    for (const token of tokens) {
      if (selected.size >= capped) break;
      add(this.queryAll<LearningItem>(
        `SELECT * FROM learning_items
         WHERE language = ? AND status IN ('active', 'cooling_down')
           AND (lower(title) LIKE ? OR lower(COALESCE(prompt_l2, '')) LIKE ? OR lower(COALESCE(evidence_snippet, '')) LIKE ?)
         ORDER BY evidence_count ASC, priority DESC, datetime(updated_at) DESC, id DESC
         LIMIT 8`,
        [this.languageId, `%${token}%`, `%${token}%`, `%${token}%`],
      ));
    }

    add(this.queryAll<LearningItem>(
      `SELECT * FROM learning_items
       WHERE language = ? AND status IN ('active', 'cooling_down')
         AND last_reactivated_at IS NOT NULL
         AND datetime(last_reactivated_at) >= datetime('now', '-1 day')
       ORDER BY datetime(last_reactivated_at) DESC, evidence_count ASC, priority DESC
       LIMIT ?`,
      [this.languageId, Math.min(20, capped)],
    ));
    add(await this.listDueLearningItems(Math.min(20, capped)));
    add(this.queryAll<LearningItem>(
      `SELECT * FROM learning_items
       WHERE language = ? AND status IN ('active', 'cooling_down')
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC, id DESC
       LIMIT ?`,
      [this.languageId, Math.min(20, capped)],
    ));
    add(this.queryAll<LearningItem>(
      `SELECT * FROM learning_items
       WHERE language = ? AND status = 'active'
       ORDER BY priority DESC, evidence_count ASC, datetime(created_at) ASC, id ASC
       LIMIT ?`,
      [this.languageId, capped],
    ));

    return Array.from(selected.values()).slice(0, capped);
  }

  async markLearningItemsReintroduced(ids: number[]): Promise<number> {
    const cleanIds = Array.from(new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
    if (cleanIds.length === 0) return 0;
    const now = nowIso();
    let changed = 0;
    for (const id of cleanIds) {
      const item = this.queryRow<LearningItem>(`SELECT * FROM learning_items WHERE id = ? AND language = ?`, [id, this.languageId]);
      if (!item) continue;
      this.db.run(
        `UPDATE learning_items
         SET last_reactivated_at = ?, next_reactivation_at = ?, updated_at = ?
         WHERE id = ? AND language = ?`,
        [now, afterReintroductionDate(Number(item.active_score ?? 0), Number(item.passive_score ?? 0)), now, id, this.languageId],
      );
      changed += this.db.getRowsModified();
    }
    if (changed > 0) this.save();
    return changed;
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
