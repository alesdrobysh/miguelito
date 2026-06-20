import type { Database } from "sql.js";

const REMOVED_LEARNING_TABLES = [
  "vocabulary_items",
  "vocabulary_candidates",
  "vocab_review_attempts",
];

const REMOVED_INDEXES = [
  "idx_vocab_chunk_unique",
  "idx_vocab_pro_due",
  "idx_vocab_rec_due",
  "idx_vocab_language_chunk_unique",
  "idx_vocab_candidates_language_chunk_unique",
  "idx_vocab_candidates_status_priority",
  "idx_vocab_attempts_active",
];

export function dropLegacyLearningTables(db: Database): void {
  for (const index of REMOVED_INDEXES) db.run(`DROP INDEX IF EXISTS ${index}`);
  for (const table of REMOVED_LEARNING_TABLES) db.run(`DROP TABLE IF EXISTS ${table}`);
}

export function runMigrations(db: Database): void {
  dropLegacyLearningTables(db);

  const chatInfo = db.exec("PRAGMA table_info(chat_history)");
  const chatCols = (chatInfo[0]?.values ?? []).map((r) => r[1] as string);
  if (!chatCols.includes("session_id")) {
    db.run("ALTER TABLE chat_history ADD COLUMN session_id TEXT");
    db.run("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id)");
  }

  const profileCols = (db.exec("PRAGMA table_info(user_profile)")[0]?.values ?? []).map((r) => r[1] as string);
  if (profileCols.includes("interests") || profileCols.includes("setup_step") || profileCols.includes("native_language") || profileCols.includes("level")) {
    db.run(`CREATE TABLE user_profile_new (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      name TEXT,
      goal TEXT,
      correction_style TEXT,
      started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const cols = ["id", "name", "goal", "correction_style", "started_at", "updated_at"].filter((c) => profileCols.includes(c));
    if (cols.length > 0) {
      db.run(`INSERT INTO user_profile_new (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM user_profile`);
    }
    db.run("DROP TABLE user_profile");
    db.run("ALTER TABLE user_profile_new RENAME TO user_profile");
  }

  const convCols = (db.exec("PRAGMA table_info(conversation_state)")[0]?.values ?? []).map((r) => r[1] as string);
  if (convCols.includes("corrections_this_session")) {
    db.run(`CREATE TABLE conversation_state_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_count INTEGER DEFAULT 0,
      last_mode TEXT,
      last_two_modes TEXT DEFAULT '[]',
      topics_touched TEXT DEFAULT '[]',
      mood_hint TEXT,
      language TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.run(`INSERT INTO conversation_state_new
      (id, session_id, turn_count, last_mode, last_two_modes, topics_touched, mood_hint, started_at, updated_at)
      SELECT id, session_id, turn_count, last_mode, last_two_modes, topics_touched, mood_hint, started_at, updated_at
      FROM conversation_state`);
    db.run("DROP TABLE conversation_state");
    db.run("ALTER TABLE conversation_state_new RENAME TO conversation_state");
  }

  const cvCols = (db.exec("PRAGMA table_info(competency_vector)")[0]?.values ?? []).map((r) => r[1] as string);
  if (cvCols.includes("updated_at")) {
    const oldRows = db.exec("SELECT morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs FROM competency_vector LIMIT 1");
    db.run("DROP TABLE competency_vector");
    db.run(`CREATE TABLE competency_vector (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      morph_successes REAL NOT NULL DEFAULT 0.5,
      morph_trials REAL NOT NULL DEFAULT 1.0,
      morph_obs INTEGER NOT NULL DEFAULT 0,
      idiom_successes REAL NOT NULL DEFAULT 0.5,
      idiom_trials REAL NOT NULL DEFAULT 1.0,
      idiom_obs INTEGER NOT NULL DEFAULT 0,
      syntax_window TEXT NOT NULL DEFAULT '[]',
      reception_ewma REAL NOT NULL DEFAULT 0.5,
      reception_obs INTEGER NOT NULL DEFAULT 0,
      lexical_rarity_ewma REAL NOT NULL DEFAULT 0.0,
      self_correction_obs INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const oldRow = oldRows[0]?.values[0];
    if (oldRow) {
      db.run(
        `INSERT INTO competency_vector (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        oldRow as any[],
      );
    } else {
      db.run("INSERT INTO competency_vector DEFAULT VALUES");
    }
  } else if (cvCols.length > 0) {
    const count = db.exec("SELECT COUNT(*) FROM competency_vector")[0]?.values[0]?.[0] as number;
    if (!count) db.run("INSERT INTO competency_vector DEFAULT VALUES");
  }

  db.run("DROP TABLE IF EXISTS learner_assessments");

  const annCols = (db.exec("PRAGMA table_info(turn_annotations)")[0]?.values ?? []).map((r) => r[1] as string);
  if (!annCols.includes("lexical_rarity")) {
    db.run("ALTER TABLE turn_annotations ADD COLUMN lexical_rarity REAL DEFAULT 0.0");
    db.run("ALTER TABLE turn_annotations ADD COLUMN self_correction INTEGER NOT NULL DEFAULT 0");
  }
  const compCols = (db.exec("PRAGMA table_info(competency_vector)")[0]?.values ?? []).map((r) => r[1] as string);
  if (!compCols.includes("lexical_rarity_ewma")) {
    db.run("ALTER TABLE competency_vector ADD COLUMN lexical_rarity_ewma REAL NOT NULL DEFAULT 0.0");
    db.run("ALTER TABLE competency_vector ADD COLUMN self_correction_obs INTEGER NOT NULL DEFAULT 0");
  }

  for (const table of ["error_log", "turn_annotations", "competency_vector", "conversation_state", "chat_history"]) {
    const info = db.exec(`PRAGMA table_info(${table})`);
    const cols = (info[0]?.values ?? []).map((r) => r[1] as string);
    if (!cols.includes("language")) db.run(`ALTER TABLE ${table} ADD COLUMN language TEXT NOT NULL DEFAULT ''`);
  }

  migrateErrorLogLifecycle(db);
  migrateProficiencyEvidenceChallengeBand(db);
  dropLegacyProficiencyEvidenceLevelColumn(db);
  migrateLearningItemLifecycle(db);
  db.run("INSERT OR REPLACE INTO _buddy_meta (key, value) VALUES ('schema_version', '16')");
}

function migrateLearningItemLifecycle(db: Database): void {
  const info = db.exec("PRAGMA table_info(learning_items)");
  const cols = (info[0]?.values ?? []).map((r) => r[1] as string);
  if (cols.length === 0) return;
  const addCol = (name: string, ddl: string) => { if (!cols.includes(name)) db.run(`ALTER TABLE learning_items ADD COLUMN ${ddl}`); };
  addCol("passive_score", "passive_score REAL NOT NULL DEFAULT 0.0");
  addCol("active_score", "active_score REAL NOT NULL DEFAULT 0.0");
  addCol("stability", "stability TEXT NOT NULL DEFAULT 'new'");
  addCol("last_seen_at", "last_seen_at TEXT");
  addCol("last_reactivated_at", "last_reactivated_at TEXT");
  addCol("last_understood_at", "last_understood_at TEXT");
  addCol("last_produced_at", "last_produced_at TEXT");
  addCol("next_reactivation_at", "next_reactivation_at TEXT");
  addCol("reactivation_pressure", "reactivation_pressure TEXT NOT NULL DEFAULT 'medium'");
  addCol("evidence_count", "evidence_count INTEGER NOT NULL DEFAULT 0");
  addCol("failure_count", "failure_count INTEGER NOT NULL DEFAULT 0");
  addCol("avoidance_count", "avoidance_count INTEGER NOT NULL DEFAULT 0");
  db.run(`UPDATE learning_items
    SET next_reactivation_at = datetime(created_at, '+' || CASE WHEN priority >= 0.9 THEN 6 WHEN priority >= 0.7 THEN 18 ELSE 36 END || ' hours')
    WHERE next_reactivation_at IS NULL AND status IN ('active', 'cooling_down')`);
  db.run("CREATE INDEX IF NOT EXISTS idx_learning_items_reactivation ON learning_items(language, status, next_reactivation_at, priority DESC)");
  db.run(`CREATE TABLE IF NOT EXISTS learning_item_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learning_item_id INTEGER NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    skill TEXT NOT NULL,
    event TEXT NOT NULL,
    independence TEXT NOT NULL DEFAULT 'unknown',
    score_delta REAL NOT NULL DEFAULT 0.0,
    confidence REAL NOT NULL DEFAULT 0.5,
    evidence_snippet TEXT,
    source_type TEXT NOT NULL DEFAULT 'conversation',
    source_message_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_learning_item_evidence_item ON learning_item_evidence(language, learning_item_id, created_at DESC)");
}

function migrateErrorLogLifecycle(db: Database): void {
  const cols = (db.exec("PRAGMA table_info(error_log)")[0]?.values ?? []).map((r) => r[1] as string);
  if (cols.length === 0) return;
  if (!cols.includes("status")) db.run("ALTER TABLE error_log ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  if (!cols.includes("updated_at")) db.run("ALTER TABLE error_log ADD COLUMN updated_at TEXT");
  db.run("UPDATE error_log SET status = COALESCE(NULLIF(status, ''), 'active')");
  db.run("UPDATE error_log SET updated_at = COALESCE(updated_at, created_at, datetime('now'))");
  db.run("CREATE INDEX IF NOT EXISTS idx_error_language_status_created ON error_log(language, status, created_at DESC)");
}

function migrateProficiencyEvidenceChallengeBand(db: Database): void {
  const cols = (db.exec("PRAGMA table_info(proficiency_evidence)")[0]?.values ?? []).map((r) => r[1] as string);
  if (cols.length === 0) return;
  if (!cols.includes("challenge_band")) db.run("ALTER TABLE proficiency_evidence ADD COLUMN challenge_band TEXT NOT NULL DEFAULT 'controlled'");
  if (!cols.includes("challenge_json")) db.run("ALTER TABLE proficiency_evidence ADD COLUMN challenge_json TEXT NOT NULL DEFAULT '{}'");
  db.run("UPDATE proficiency_evidence SET challenge_band = COALESCE(NULLIF(challenge_band, ''), 'controlled')");
}

function dropLegacyProficiencyEvidenceLevelColumn(db: Database): void {
  const cols = (db.exec("PRAGMA table_info(proficiency_evidence)")[0]?.values ?? []).map((r) => r[1] as string);
  if (!cols.includes("level")) return;
  db.run(`CREATE TABLE proficiency_evidence_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    language TEXT NOT NULL DEFAULT '',
    skill TEXT NOT NULL,
    dimension TEXT NOT NULL,
    challenge_band TEXT NOT NULL,
    outcome TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    weight REAL NOT NULL DEFAULT 1.0,
    evidence_text TEXT NOT NULL DEFAULT '',
    challenge_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.run(`INSERT INTO proficiency_evidence_new (id, language, skill, dimension, challenge_band, outcome, confidence, weight, evidence_text, challenge_json, created_at)
    SELECT id, language, skill, dimension, COALESCE(NULLIF(challenge_band, ''), 'controlled'), outcome, confidence, weight, evidence_text, challenge_json, created_at
    FROM proficiency_evidence`);
  db.run("DROP TABLE proficiency_evidence");
  db.run("ALTER TABLE proficiency_evidence_new RENAME TO proficiency_evidence");
  db.run("CREATE INDEX IF NOT EXISTS idx_proficiency_evidence_language_skill ON proficiency_evidence(language, skill, dimension, challenge_band, created_at)");
}
