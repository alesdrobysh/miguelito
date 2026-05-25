import type { Database } from "sql.js";
import type { ErrorItem } from "../../domain/types.js";
import type { ErrorRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn } from "./sqlRepository.js";

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

  async listErrors(category: string, limit: number): Promise<ErrorItem[]> {
    if (category === "all") {
      return this.queryAll(`SELECT * FROM error_log WHERE language = ? ORDER BY created_at DESC LIMIT ?`, [this.languageId, limit]) as ErrorItem[];
    }
    return this.queryAll(
      `SELECT * FROM error_log WHERE language = ? AND category = ? ORDER BY created_at DESC LIMIT ?`,
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
