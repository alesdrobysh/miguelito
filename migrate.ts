/**
 * One-time migration: copy data from the old Rust/zeroclaw buddy.db into the new sql.js buddy.db.
 *
 * Usage:
 *   OLD_DB=../path/to/old/buddy.db NEW_DB=./data/buddy.db npx tsx migrate.ts
 *
 * Both databases use standard SQLite format; sql.js can read them directly.
 */
import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";

const OLD_DB = process.env.OLD_DB ?? "../.miguelito/memory/buddy.db";
const NEW_DB = process.env.NEW_DB ?? "./data/buddy.db";

async function main() {
  if (!fs.existsSync(OLD_DB)) {
    console.log(`Old database not found at ${OLD_DB} — skipping migration.`);
    return;
  }

  const SQL = await initSqlJs();

  const oldDb = new SQL.Database(new Uint8Array(fs.readFileSync(OLD_DB)));
  const newDbExists = fs.existsSync(NEW_DB);

  const newDir = path.dirname(NEW_DB);
  if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

  const newBuf = newDbExists ? new Uint8Array(fs.readFileSync(NEW_DB)) : undefined;
  const newDb = new SQL.Database(newBuf);

  let migrated = 0;

  // vocabulary_items
  const vocabRows = oldDb.exec(
    "SELECT word, translation, context_first_seen, first_seen_at, last_reviewed_at, next_review_at, status, ease_factor, repetitions, interval_days FROM vocabulary_items"
  );
  if (vocabRows.length > 0) {
    const stmt = newDb.prepare(
      "INSERT OR IGNORE INTO vocabulary_items (word, translation, context_first_seen, first_seen_at, last_reviewed_at, next_review_at, status, ease_factor, repetitions, interval_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const row of vocabRows[0].values) {
      stmt.run(row);
      migrated++;
    }
    stmt.free();
    console.log(`Migrated ${vocabRows[0].values.length} vocabulary items.`);
  }

  // error_log
  const errorRows = oldDb.exec(
    "SELECT user_text, correct_form, category, note, created_at FROM error_log"
  );
  if (errorRows.length > 0) {
    const stmt = newDb.prepare(
      "INSERT INTO error_log (user_text, correct_form, category, note, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const row of errorRows[0].values) {
      stmt.run(row);
      migrated++;
    }
    stmt.free();
    console.log(`Migrated ${errorRows[0].values.length} error log entries.`);
  }

  // user_profile (single row)
  const profileRows = oldDb.exec(
    "SELECT name, native_language, level, goal, correction_style, interests, setup_step, started_at, updated_at FROM user_profile WHERE id = 1"
  );
  if (profileRows.length > 0 && profileRows[0].values.length > 0) {
    const r = profileRows[0].values[0];
    newDb.run(
      "INSERT OR IGNORE INTO user_profile (id, name, native_language, level, goal, correction_style, interests, setup_step, started_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r
    );
    migrated++;
    console.log("Migrated user profile.");
  }

  // user_interests
  const interestRows = oldDb.exec(
    "SELECT interest, source, confidence, first_seen_at, last_seen_at FROM user_interests"
  );
  if (interestRows.length > 0) {
    const stmt = newDb.prepare(
      "INSERT OR IGNORE INTO user_interests (interest, source, confidence, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const row of interestRows[0].values) {
      stmt.run(row);
      migrated++;
    }
    stmt.free();
    console.log(`Migrated ${interestRows[0].values.length} interests.`);
  }

  // persist new DB
  fs.writeFileSync(NEW_DB, Buffer.from(newDb.export()));

  oldDb.close();
  newDb.close();

  console.log(`\nDone. Migrated ${migrated} total rows → ${NEW_DB}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
