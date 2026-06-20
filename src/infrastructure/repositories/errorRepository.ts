import type { Database } from "sql.js";
import type { ErrorItem } from "../../domain/types.js";
import type { ErrorRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn, nowIso } from "./sqlRepository.js";

function canonicalErrorText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:"'`´()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalErrorKey(row: Pick<ErrorItem, "user_text" | "correct_form" | "category">): string {
  return [row.category, canonicalErrorText(row.user_text), canonicalErrorText(row.correct_form)].join("\u0000");
}

function levenshteinSimilarity(a: string, b: string): number {
  const left = canonicalErrorText(a);
  const right = canonicalErrorText(b);
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
  return 1 - prev[m] / Math.max(n, m);
}

function mergeNotes(...notes: unknown[]): string | null {
  const merged = Array.from(new Set(notes.map((n) => String(n ?? "").trim()).filter(Boolean))).join(" | ");
  return merged || null;
}

export class SqlErrorRepository extends SqlRepository implements ErrorRepository {
  private readonly validCategories: ReadonlySet<string>;

  constructor(db: Database, languageId: string, save: SaveFn, validCategories: readonly string[]) {
    super(db, languageId, save);
    this.validCategories = new Set(validCategories);
  }

  private normalizeCategory(category: string): string {
    if (this.validCategories.has(category)) return category;
    return "other";
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

  async deduplicateErrors(limit = 1000): Promise<number> {
    const capped = Math.max(1, Math.min(5000, Math.round(limit || 1000)));
    const rows = this.queryAll<ErrorItem & { status?: string }>(
      `SELECT * FROM error_log
       WHERE language = ? AND COALESCE(status, 'active') = 'active'
       ORDER BY datetime(created_at) ASC, id ASC
       LIMIT ?`,
      [this.languageId, capped],
    );
    const groups = new Map<string, Array<ErrorItem & { status?: string }>>();
    for (const row of rows) {
      const key = canonicalErrorKey(row);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    let changed = 0;
    const now = nowIso();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [keeper, ...duplicates] = group.sort((a, b) => a.id - b.id);
      const notes = [keeper.note, ...duplicates.map((d) => d.note)]
        .map((n) => String(n ?? "").trim())
        .filter(Boolean);
      const mergedNote = Array.from(new Set(notes)).join(" | ") || null;
      this.db.run(
        `UPDATE error_log SET note = ?, updated_at = ? WHERE id = ? AND language = ?`,
        [mergedNote, now, keeper.id, this.languageId],
      );
      for (const dup of duplicates) {
        this.db.run(
          `UPDATE error_log SET status = 'archived', updated_at = ? WHERE id = ? AND language = ?`,
          [now, dup.id, this.languageId],
        );
        changed++;
      }
    }
    if (changed > 0) this.save();
    return changed;
  }

  async deduplicateFuzzyErrors(limit = 1000): Promise<number> {
    const capped = Math.max(1, Math.min(5000, Math.round(limit || 1000)));
    const rows = this.queryAll<ErrorItem & { status?: string }>(
      `SELECT * FROM error_log
       WHERE language = ? AND COALESCE(status, 'active') = 'active'
       ORDER BY datetime(created_at) ASC, id ASC
       LIMIT ?`,
      [this.languageId, capped],
    );
    let changed = 0;
    const archived = new Set<number>();
    const now = nowIso();
    for (let i = 0; i < rows.length; i++) {
      const keeper = rows[i];
      if (archived.has(keeper.id)) continue;
      for (let j = i + 1; j < rows.length; j++) {
        const dup = rows[j];
        if (archived.has(dup.id)) continue;
        if (keeper.category !== dup.category) continue;
        const userSimilarity = levenshteinSimilarity(keeper.user_text, dup.user_text);
        const correctSimilarity = levenshteinSimilarity(keeper.correct_form, dup.correct_form);
        const sameCorrect = canonicalErrorText(keeper.correct_form) === canonicalErrorText(dup.correct_form);
        const highConfidence = sameCorrect
          ? userSimilarity >= 0.82
          : userSimilarity >= 0.9 && correctSimilarity >= 0.9;
        if (!highConfidence) continue;
        this.db.run(
          `UPDATE error_log SET note = ?, updated_at = ? WHERE id = ? AND language = ?`,
          [mergeNotes(keeper.note, dup.note), now, keeper.id, this.languageId],
        );
        this.db.run(
          `UPDATE error_log SET status = 'archived', updated_at = ? WHERE id = ? AND language = ?`,
          [now, dup.id, this.languageId],
        );
        archived.add(dup.id);
        keeper.note = mergeNotes(keeper.note, dup.note) ?? "";
        changed++;
      }
    }
    if (changed > 0) this.save();
    return changed;
  }

  async listErrors(category: string, limit: number): Promise<ErrorItem[]> {
    if (category === "all") {
      return this.queryAll(`SELECT * FROM error_log WHERE language = ? AND COALESCE(status, 'active') = 'active' ORDER BY created_at DESC LIMIT ?`, [this.languageId, limit]) as ErrorItem[];
    }
    return this.queryAll(
      `SELECT * FROM error_log WHERE language = ? AND category = ? AND COALESCE(status, 'active') = 'active' ORDER BY created_at DESC LIMIT ?`,
      [this.languageId, category, limit]
    ) as ErrorItem[];
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
}
