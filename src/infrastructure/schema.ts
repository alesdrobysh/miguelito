export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL DEFAULT 'local',
    external_user_id TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, external_user_id)
);
INSERT OR IGNORE INTO users (id, platform, external_user_id, display_name)
VALUES (1, 'local', 'default', 'Default user');
CREATE TABLE IF NOT EXISTS learning_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    language TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    prompt_l2 TEXT,
    explanation_l1 TEXT,
    source_type TEXT NOT NULL DEFAULT 'conversation',
    source_message_id INTEGER,
    evidence_snippet TEXT,
    priority REAL NOT NULL DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'active',
    practice_modes_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    due_at TEXT,
    last_practiced_at TEXT,
    reps INTEGER NOT NULL DEFAULT 0,
    passive_score REAL NOT NULL DEFAULT 0.0,
    active_score REAL NOT NULL DEFAULT 0.0,
    stability TEXT NOT NULL DEFAULT 'new',
    last_seen_at TEXT,
    last_reactivated_at TEXT,
    last_understood_at TEXT,
    last_produced_at TEXT,
    next_reactivation_at TEXT,
    reactivation_pressure TEXT NOT NULL DEFAULT 'medium',
    evidence_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    avoidance_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_items_user_language_type_title_unique ON learning_items(user_id, language, type, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_learning_items_status_priority ON learning_items(user_id, language, status, priority DESC, created_at);
CREATE TABLE IF NOT EXISTS learning_item_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
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
);
CREATE INDEX IF NOT EXISTS idx_learning_item_evidence_item ON learning_item_evidence(user_id, language, learning_item_id, created_at DESC);
CREATE TABLE IF NOT EXISTS learning_practice_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    learning_item_id INTEGER NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    prompt_text TEXT,
    user_response TEXT,
    grade INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_practice_attempts_active ON learning_practice_attempts(user_id, language, status, created_at);

CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    user_text TEXT NOT NULL,
    correct_form TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    language TEXT NOT NULL DEFAULT '',
    note TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_error_category ON error_log(category);
CREATE INDEX IF NOT EXISTS idx_error_created ON error_log(created_at);

CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    name TEXT,
    goal TEXT,
    correction_style TEXT,
    started_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_user_unique ON user_profile(user_id);

CREATE TABLE IF NOT EXISTS turn_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    session_id TEXT,
    turn_number INTEGER,
    obligatory_json TEXT NOT NULL DEFAULT '[]',
    used_json TEXT NOT NULL DEFAULT '[]',
    naturalness REAL,
    comprehension TEXT NOT NULL DEFAULT 'smooth',
    tunit_length INTEGER NOT NULL DEFAULT 1,
    had_subordination INTEGER NOT NULL DEFAULT 0,
    lexical_rarity REAL DEFAULT 0.0,
    self_correction INTEGER NOT NULL DEFAULT 0,
    language TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotation_created ON turn_annotations(created_at);

CREATE TABLE IF NOT EXISTS competency_vector (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
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
);

CREATE TABLE IF NOT EXISTS _buddy_meta (
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS user_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    interest TEXT NOT NULL COLLATE NOCASE,
    source TEXT DEFAULT 'conversation',
    confidence REAL DEFAULT 0.5,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_interest_unique ON user_interests(user_id, interest COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS conversation_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    session_id TEXT NOT NULL,
    turn_count INTEGER DEFAULT 0,
    last_mode TEXT,
    last_two_modes TEXT DEFAULT '[]',
    topics_touched TEXT DEFAULT '[]',
    mood_hint TEXT,
    language TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    session_id TEXT,
    language TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_history_chat_id ON chat_history(user_id, chat_id, id);

CREATE TABLE IF NOT EXISTS proficiency_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
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
);
CREATE INDEX IF NOT EXISTS idx_proficiency_evidence_language_skill ON proficiency_evidence(language, skill, dimension, challenge_band, created_at);
`;
