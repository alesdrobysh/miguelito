import type { Database } from "sql.js";
import type { UserProfile } from "../../domain/types.js";
import type { ProfileRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn, nowIso } from "./sqlRepository.js";

export class SqlProfileRepository extends SqlRepository implements ProfileRepository {
  constructor(db: Database, languageId: string, save: SaveFn, userId = 1) {
    super(db, languageId, save, userId);
  }

  async getProfile(): Promise<UserProfile | null> {
    const row = this.queryRow(`SELECT * FROM user_profile WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [this.userId]);
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
      `INSERT OR IGNORE INTO user_profile (user_id, started_at, updated_at) VALUES (?, ?, ?)`,
      [this.userId, nowIso(), nowIso()]
    );
    this.save();

    if (Object.keys(filtered).length === 0) return [];

    const keys = Object.keys(filtered);
    const setClauses = keys.map((k) => `${k} = ?`).join(", ");
    const values = [...Object.values(filtered), nowIso()];
    this.db.run(
      `UPDATE user_profile SET ${setClauses}, updated_at = ? WHERE user_id = ?`,
      [...values, this.userId]
    );
    this.save();

    return keys;
  }
}
