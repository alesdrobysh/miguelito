import type { Database } from "sql.js";
import type { InterestRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn, nowIso } from "./sqlRepository.js";

export class SqlInterestRepository extends SqlRepository implements InterestRepository {
  constructor(db: Database, languageId: string, save: SaveFn) {
    super(db, languageId, save);
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
}
