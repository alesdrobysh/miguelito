import type { Database } from "sql.js";

export function runMigrations(db: Database): void {
  // v1: chat_history.session_id
  const chatInfo = db.exec("PRAGMA table_info(chat_history)");
  const chatCols = (chatInfo[0]?.values ?? []).map((r) => r[1] as string);
  if (!chatCols.includes("session_id")) {
    db.run("ALTER TABLE chat_history ADD COLUMN session_id TEXT");
    db.run("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id)");
  }

  const verRow = db.exec("SELECT value FROM _buddy_meta WHERE key = 'schema_version'");
  const ver = verRow[0]?.values[0]?.[0] as string | undefined;
  if (ver === "6") return;

  // v3: rebuild vocabulary_items — word+translation → chunk_l2 (L2-only) + FSRS state
  const vocabInfo = db.exec("PRAGMA table_info(vocabulary_items)");
  const vocabCols = (vocabInfo[0]?.values ?? []).map((r) => r[1] as string);
  if (vocabCols.includes("word") && !vocabCols.includes("chunk_l2")) {
    db.run(`
      CREATE TABLE vocabulary_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_l2 TEXT NOT NULL,
        anchor TEXT,
        capture_context_l2 TEXT,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        pro_stability REAL DEFAULT 1.0,
        pro_difficulty REAL DEFAULT 5.0,
        pro_due DATETIME,
        pro_last_review DATETIME,
        pro_reps INTEGER DEFAULT 0,
        rec_stability REAL DEFAULT 1.0,
        rec_difficulty REAL DEFAULT 5.0,
        rec_due DATETIME,
        rec_last_review DATETIME,
        rec_reps INTEGER DEFAULT 0
      )
    `);
    db.run(`
      INSERT INTO vocabulary_items_new (id, chunk_l2, anchor, capture_context_l2, first_seen_at)
      SELECT id, word, NULL, context_first_seen, first_seen_at FROM vocabulary_items
    `);
    db.run("DROP TABLE vocabulary_items");
    db.run("ALTER TABLE vocabulary_items_new RENAME TO vocabulary_items");
    db.run("CREATE UNIQUE INDEX idx_vocab_chunk_unique ON vocabulary_items(chunk_l2 COLLATE NOCASE)");
    db.run("CREATE INDEX idx_vocab_pro_due ON vocabulary_items(pro_due)");
  }

  // v4: drop obsolete legacy status column from pre-language, pre-FSRS vocabulary schema.
  // Modern Miguelito intentionally uses vocabulary_items.status for active/suspended/retired,
  // so only rebuild very old tables that have status but do not yet have language scoping.
  const vocabColsNow = (db.exec("PRAGMA table_info(vocabulary_items)")[0]?.values ?? []).map((r) => r[1] as string);
  if (vocabColsNow.includes("status") && !vocabColsNow.includes("language")) {
    db.run(`
      CREATE TABLE vocabulary_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_l2 TEXT NOT NULL,
        anchor TEXT,
        capture_context_l2 TEXT,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        pro_stability REAL DEFAULT 1.0,
        pro_difficulty REAL DEFAULT 5.0,
        pro_due DATETIME,
        pro_last_review DATETIME,
        pro_reps INTEGER DEFAULT 0,
        rec_stability REAL DEFAULT 1.0,
        rec_difficulty REAL DEFAULT 5.0,
        rec_due DATETIME,
        rec_last_review DATETIME,
        rec_reps INTEGER DEFAULT 0
      )
    `);
    db.run(`
      INSERT INTO vocabulary_items_new
        (id, chunk_l2, anchor, capture_context_l2, first_seen_at,
         pro_stability, pro_difficulty, pro_due, pro_last_review, pro_reps,
         rec_stability, rec_difficulty, rec_due, rec_last_review, rec_reps)
      SELECT
        id, chunk_l2, anchor, capture_context_l2, first_seen_at,
        pro_stability, pro_difficulty, pro_due, pro_last_review, pro_reps,
        rec_stability, rec_difficulty, rec_due, rec_last_review, rec_reps
      FROM vocabulary_items
    `);
    db.run("DROP TABLE vocabulary_items");
    db.run("ALTER TABLE vocabulary_items_new RENAME TO vocabulary_items");
    db.run("CREATE UNIQUE INDEX idx_vocab_chunk_unique ON vocabulary_items(chunk_l2 COLLATE NOCASE)");
    db.run("CREATE INDEX idx_vocab_pro_due ON vocabulary_items(pro_due)");
  }

  const profileCols = (db.exec("PRAGMA table_info(user_profile)")[0]?.values ?? []).map((r) => r[1] as string);
  if (profileCols.includes("interests") || profileCols.includes("setup_step")) {
    db.run(`
      CREATE TABLE user_profile_new (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        name TEXT,
        native_language TEXT,
        level TEXT,
        goal TEXT,
        correction_style TEXT,
        started_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run(`
      INSERT INTO user_profile_new (id, name, native_language, level, goal, correction_style, started_at, updated_at)
      SELECT id, name, native_language, level, goal, correction_style, started_at, updated_at FROM user_profile
    `);
    db.run("DROP TABLE user_profile");
    db.run("ALTER TABLE user_profile_new RENAME TO user_profile");
  }

  const convCols = (db.exec("PRAGMA table_info(conversation_state)")[0]?.values ?? []).map((r) => r[1] as string);
  if (convCols.includes("corrections_this_session")) {
    db.run(`
      CREATE TABLE conversation_state_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_count INTEGER DEFAULT 0,
        last_mode TEXT,
        last_two_modes TEXT DEFAULT '[]',
        topics_touched TEXT DEFAULT '[]',
        mood_hint TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run(`
      INSERT INTO conversation_state_new
        (id, session_id, turn_count, last_mode, last_two_modes, topics_touched, mood_hint, started_at, updated_at)
      SELECT
        id, session_id, turn_count, last_mode, last_two_modes, topics_touched, mood_hint, started_at, updated_at
      FROM conversation_state
    `);
    db.run("DROP TABLE conversation_state");
    db.run("ALTER TABLE conversation_state_new RENAME TO conversation_state");
  }

  // v6: convert competency_vector from single-row (id=1 constraint) to append-only time-series.
  // Detect old schema by presence of `updated_at` column (new schema uses `created_at`).
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const oldRow = oldRows[0]?.values[0];
    if (oldRow) {
      db.run(
        `INSERT INTO competency_vector (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        oldRow as any[]
      );
    } else {
      db.run("INSERT INTO competency_vector DEFAULT VALUES");
    }
  } else if (cvCols.length > 0) {
    // New schema already, just seed if empty
    const count = db.exec("SELECT COUNT(*) FROM competency_vector")[0]?.values[0]?.[0] as number;
    if (!count) db.run("INSERT INTO competency_vector DEFAULT VALUES");
  } else {
    // Table didn't exist (very old DB, pre-v5) — SCHEMA created it with new schema above
    db.run("INSERT INTO competency_vector DEFAULT VALUES");
  }

  // v7: drop obsolete learner_assessments table
  db.run("DROP TABLE IF EXISTS learner_assessments");

  // v8: drop native_language and level from user_profile
  const profileColsV8 = (db.exec("PRAGMA table_info(user_profile)")[0]?.values ?? []).map((r) => r[1] as string);
  if (profileColsV8.includes("native_language") || profileColsV8.includes("level")) {
    db.run(`CREATE TABLE user_profile_new (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      name TEXT,
      goal TEXT,
      correction_style TEXT,
      started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`INSERT INTO user_profile_new (id, name, goal, correction_style, started_at, updated_at)
      SELECT id, name, goal, correction_style, started_at, updated_at FROM user_profile`);
    db.run("DROP TABLE user_profile");
    db.run("ALTER TABLE user_profile_new RENAME TO user_profile");
  }

  // v10: lexical_rarity and self_correction
  const annInfo = db.exec("PRAGMA table_info(turn_annotations)");
  const annCols = (annInfo[0]?.values ?? []).map((r) => r[1] as string);
  if (!annCols.includes("lexical_rarity")) {
    db.run("ALTER TABLE turn_annotations ADD COLUMN lexical_rarity REAL DEFAULT 0.0");
    db.run("ALTER TABLE turn_annotations ADD COLUMN self_correction INTEGER NOT NULL DEFAULT 0");
  }
  const compInfo = db.exec("PRAGMA table_info(competency_vector)");
  const compCols = (compInfo[0]?.values ?? []).map((r) => r[1] as string);
  if (!compCols.includes("lexical_rarity_ewma")) {
    db.run("ALTER TABLE competency_vector ADD COLUMN lexical_rarity_ewma REAL NOT NULL DEFAULT 0.0");
    db.run("ALTER TABLE competency_vector ADD COLUMN self_correction_obs INTEGER NOT NULL DEFAULT 0");
  }

  db.run("INSERT OR REPLACE INTO _buddy_meta (key, value) VALUES ('schema_version', '10')");

  // v9: language-scoping for all teaching-related tables
  const tablesToScope = [
    "vocabulary_items",
    "error_log",
    "turn_annotations",
    "competency_vector",
    "conversation_state",
    "chat_history"
  ];
  for (const table of tablesToScope) {
    const info = db.exec(`PRAGMA table_info(${table})`);
    const cols = (info[0]?.values ?? []).map((r) => r[1] as string);
    if (!cols.includes("language")) {
      db.run(`ALTER TABLE ${table} ADD COLUMN language TEXT NOT NULL DEFAULT ''`);
    }
  }

  db.run(`CREATE TABLE IF NOT EXISTS learning_practice_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learning_item_id INTEGER NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    prompt_text TEXT,
    user_response TEXT,
    grade INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_learning_practice_attempts_active ON learning_practice_attempts(language, status, created_at)");

  try {
    db.run("DROP INDEX IF EXISTS idx_vocab_chunk_unique");
    const vocabColsNow = (db.exec("PRAGMA table_info(vocabulary_items)")[0]?.values ?? []).map((r) => r[1] as string);
    const addVocabCol = (name: string, ddl: string) => { if (!vocabColsNow.includes(name)) db.run(`ALTER TABLE vocabulary_items ADD COLUMN ${ddl}`); };
    addVocabCol("status", "status TEXT NOT NULL DEFAULT 'active'");
    addVocabCol("source_type", "source_type TEXT");
    addVocabCol("source_candidate_id", "source_candidate_id INTEGER");
    addVocabCol("meaning_l1", "meaning_l1 TEXT");
    addVocabCol("topic_tags_json", "topic_tags_json TEXT NOT NULL DEFAULT '[]'");
    addVocabCol("acceptable_variants_json", "acceptable_variants_json TEXT NOT NULL DEFAULT '[]'");
    addVocabCol("elicitation_cues_json", "elicitation_cues_json TEXT NOT NULL DEFAULT '[]'");
    addVocabCol("promotion_reason", "promotion_reason TEXT");
    addVocabCol("last_seen_in_chat_at", "last_seen_in_chat_at TEXT");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_language_chunk_unique ON vocabulary_items(language, chunk_l2 COLLATE NOCASE)");
    db.run("CREATE INDEX IF NOT EXISTS idx_vocab_pro_due ON vocabulary_items(language, pro_due)");
    db.run("CREATE INDEX IF NOT EXISTS idx_vocab_rec_due ON vocabulary_items(language, rec_due)");
    db.run(`CREATE TABLE IF NOT EXISTS vocabulary_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_l2 TEXT NOT NULL,
      anchor TEXT,
      meaning_l1 TEXT,
      capture_context_l2 TEXT,
      language TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'conversation',
      source_message_id INTEGER,
      evidence_snippet TEXT,
      proposed_by TEXT NOT NULL DEFAULT 'evaluator',
      priority REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'candidate',
      duplicate_of INTEGER,
      topic_tags_json TEXT NOT NULL DEFAULT '[]',
      acceptable_variants_json TEXT NOT NULL DEFAULT '[]',
      elicitation_cues_json TEXT NOT NULL DEFAULT '[]',
      promotion_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    )`);
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_candidates_language_chunk_unique ON vocabulary_candidates(language, chunk_l2 COLLATE NOCASE)");
    db.run("CREATE INDEX IF NOT EXISTS idx_vocab_candidates_status_priority ON vocabulary_candidates(language, status, priority DESC, created_at)");
    db.run(`CREATE TABLE IF NOT EXISTS vocab_review_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vocab_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      strategy TEXT,
      prompt_text TEXT,
      user_response TEXT,
      target_used INTEGER NOT NULL DEFAULT 0,
      accepted_variant TEXT,
      hint_level INTEGER NOT NULL DEFAULT 0,
      grade INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_vocab_attempts_active ON vocab_review_attempts(language, status, created_at)");
  } catch {}
}
