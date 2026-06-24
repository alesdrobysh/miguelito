import type { BuddyDb } from "../infrastructure/db.js";
import type { LearningHygieneRunResult } from "../domain/types.js";

export class LearningHygieneService {
  constructor(private learning: BuddyDb) {}

  async run(): Promise<LearningHygieneRunResult> {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const lang = this.learning.languageId;
    let archived = 0;
    let cooledDown = 0;
    let promoted = 0;
    let mastered = 0;
    let ignored = 0;

    this.learning.db.run(
      `UPDATE learning_items
       SET status = 'archived', updated_at = ?
       WHERE language = ?
         AND status = 'candidate'
         AND evidence_count = 0
         AND datetime(created_at) <= datetime('now', '-7 days')`,
      [now, lang],
    );
    archived += this.learning.db.getRowsModified();

    this.learning.db.run(
      `UPDATE learning_items
       SET status = 'cooling_down', next_reactivation_at = datetime('now', '+7 days'), reactivation_pressure = 'low', updated_at = ?
       WHERE language = ?
         AND status = 'active'
         AND stability = 'new'
         AND evidence_count = 0
         AND datetime(created_at) <= datetime('now', '-14 days')`,
      [now, lang],
    );
    cooledDown += this.learning.db.getRowsModified();

    this.learning.db.run(
      `UPDATE learning_items
       SET status = 'active', updated_at = ?
       WHERE language = ?
         AND status = 'candidate'
         AND evidence_count > 0`,
      [now, lang],
    );
    promoted += this.learning.db.getRowsModified();

    this.learning.db.run(
      `UPDATE learning_items
       SET status = 'mastered', reactivation_pressure = 'low', next_reactivation_at = datetime('now', '+30 days'), updated_at = ?
       WHERE language = ?
         AND status IN ('active', 'cooling_down', 'stable')
         AND active_score >= 0.8
         AND passive_score >= 0.7
         AND last_produced_at IS NOT NULL`,
      [now, lang],
    );
    mastered += this.learning.db.getRowsModified();

    this.learning.db.run(
      `UPDATE learning_items
       SET status = 'ignored', updated_at = ?
       WHERE language = ?
         AND status NOT IN ('ignored', 'archived', 'mastered')
         AND type = 'correction'
         AND lower(title) LIKE lower('Auw → Australia')`,
      [now, lang],
    );
    ignored += this.learning.db.getRowsModified();

    if (archived + cooledDown + promoted + mastered + ignored > 0) {
      // BuddyDb has no public save method; a no-op meta write is the smallest existing flush path.
      await this.learning.setMetaValue("last_learning_hygiene_run", now);
    }

    return { archived, cooledDown, promoted, mastered, ignored };
  }
}
