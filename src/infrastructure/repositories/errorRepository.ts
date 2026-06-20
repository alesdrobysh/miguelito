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
