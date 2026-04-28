import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "./db.js";
import { sm2Review, statusOf } from "./sm2.js";

let db: BuddyDb;
let dbPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-test-"));
  dbPath = path.join(tmpDir, "test.db");
  db = new BuddyDb(dbPath);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sm2", () => {
  it("statusOf returns correct statuses", () => {
    expect(statusOf(0, 0)).toBe("new");
    expect(statusOf(1, 1)).toBe("learning");
    expect(statusOf(2, 6)).toBe("learning");
    expect(statusOf(3, 15)).toBe("review");
    expect(statusOf(6, 30)).toBe("mastered");
    expect(statusOf(6, 20)).toBe("review");
    expect(statusOf(10, 100)).toBe("mastered");
  });

  it("sm2Review with quality >= 3 advances repetitions", () => {
    const r = sm2Review(2.5, 0, 0, 4);
    expect(r.repetitions).toBe(1);
    expect(r.interval_days).toBe(1);
    expect(r.status).toBe("learning");
  });

  it("sm2Review second repetition gives interval 6", () => {
    const r = sm2Review(2.5, 1, 1, 4);
    expect(r.repetitions).toBe(2);
    expect(r.interval_days).toBe(6);
  });

  it("sm2Review uses ease factor for later repetitions", () => {
    const r = sm2Review(2.5, 2, 6, 4);
    expect(r.repetitions).toBe(3);
    expect(r.interval_days).toBe(15);
  });

  it("sm2Review resets on quality < 3", () => {
    const r = sm2Review(2.5, 5, 100, 2);
    expect(r.repetitions).toBe(0);
    expect(r.interval_days).toBe(1);
    expect(r.status).toBe("new");
  });

  it("sm2Review eases factor adjusts", () => {
    const r = sm2Review(2.5, 0, 0, 5);
    expect(r.ease_factor).toBe(2.6);
  });

  it("sm2Review eases factor has minimum 1.3", () => {
    const r = sm2Review(1.3, 0, 0, 0);
    expect(r.ease_factor).toBe(1.3);
  });
});

describe("BuddyDb vocabulary", () => {
  it("addVocab inserts a new word and returns id", () => {
    const id = db.addVocab("gato", "cat", "El gato duerme");
    expect(id).toBeTypeOf("number");
    expect(id).toBeGreaterThan(0);
  });

  it("addVocab returns null on duplicate word (case-insensitive)", () => {
    db.addVocab("gato", "cat", "El gato duerme");
    const id2 = db.addVocab("Gato", "cat", "another context");
    expect(id2).toBeNull();
  });

  it("listVocab with 'all' returns all items", () => {
    db.addVocab("gato", "cat", "ctx1");
    db.addVocab("perro", "dog", "ctx2");
    const items = db.listVocab("all", 10);
    expect(items).toHaveLength(2);
  });

  it("listVocab filters by bucket", () => {
    db.addVocab("gato", "cat", "ctx");
    db.addVocab("perro", "dog", "ctx");
    const items = db.listVocab("new", 10);
    expect(items).toHaveLength(2);

    const learning = db.listVocab("learning", 10);
    expect(learning).toHaveLength(0);
  });

  it("dueVocab returns items with null next_review_at", () => {
    db.addVocab("gato", "cat", "ctx");
    const due = db.dueVocab(10);
    expect(due).toHaveLength(1);
    expect(due[0].word).toBe("gato");
  });

  it("scoreVocab updates word with SM-2 result", () => {
    db.addVocab("gato", "cat", "ctx");
    const result = db.scoreVocab("gato", 4);
    expect(result.repetitions).toBe(1);
    expect(result.interval_days).toBe(1);
    expect(result.status).toBe("learning");
    expect(result.next_review_at).toBeTruthy();
  });

  it("scoreVocab throws on missing word", () => {
    expect(() => db.scoreVocab("nonexistent", 4)).toThrow();
  });

  it("scoreVocab transitions from new to learning to review to mastered", () => {
    db.addVocab("casa", "house", "ctx");
    let r = db.scoreVocab("casa", 4);
    expect(r.status).toBe("learning");

    r = db.scoreVocab("casa", 4);
    expect(r.status).toBe("learning");

    r = db.scoreVocab("casa", 4);
    expect(r.status).toBe("review");

    for (let i = 0; i < 3; i++) {
      r = db.scoreVocab("casa", 4);
    }
    expect(r.status).toBe("mastered");
  });
});

describe("BuddyDb error log", () => {
  it("logError inserts an error and returns id", () => {
    const id = db.logError("la gata", "el gato", "gender", "wrong gender");
    expect(id).toBeTypeOf("number");
  });

  it("logError defaults unknown category to other", () => {
    db.logError("yo es", "yo soy", "nonexistent_category", "");
    const errors = db.listErrors("other", 10);
    expect(errors).toHaveLength(1);
  });

  it("listErrors filters by category", () => {
    db.logError("la gata", "el gato", "gender", "");
    db.logError("yo cantado", "yo he cantado", "verb_conjugation", "");
    db.logError("a escuela", "a la escuela", "preposition", "");

    const gender = db.listErrors("gender", 10);
    expect(gender).toHaveLength(1);

    const all = db.listErrors("all", 10);
    expect(all).toHaveLength(3);
  });

  it("listErrors respects limit", () => {
    for (let i = 0; i < 5; i++) {
      db.logError(`err${i}`, `cor${i}`, "other", "");
    }
    const errors = db.listErrors("all", 3);
    expect(errors).toHaveLength(3);
  });
});

describe("BuddyDb profile", () => {
  it("getProfile returns null initially", () => {
    expect(db.getProfile()).toBeNull();
  });

  it("setProfile creates and updates profile fields", () => {
    const updated = db.setProfile({ name: "Alice", level: "A2" });
    expect(updated).toContain("name");
    expect(updated).toContain("level");

    const profile = db.getProfile();
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("Alice");
    expect(profile!.level).toBe("A2");
  });

  it("setProfile updates existing profile", () => {
    db.setProfile({ name: "Alice" });
    db.setProfile({ level: "B1" });

    const profile = db.getProfile();
    expect(profile!.name).toBe("Alice");
    expect(profile!.level).toBe("B1");
  });

  it("setProfile ignores invalid keys", () => {
    const updated = db.setProfile({ hacker: "yes" } as Record<string, string>);
    expect(updated).toHaveLength(0);
  });
});

describe("BuddyDb conversation state", () => {
  it("getConversationState creates new session when none exists", () => {
    const result = db.getConversationState();
    expect(result.isNew).toBe(true);
    expect(result.session.session_id).toBeTruthy();
    expect(result.session.turn_count).toBe(0);
  });

  it("getConversationState returns existing session within 30 min", () => {
    const first = db.getConversationState();
    const second = db.getConversationState();
    expect(second.isNew).toBe(false);
    expect(second.session.id).toBe(first.session.id);
  });

  it("getConversationState creates new session after 30 min gap (simulated by updating updated_at)", () => {
    const first = db.getConversationState();
    const oldTime = new Date(Date.now() - 31 * 60000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const oldStr = `${oldTime.getFullYear()}-${pad(oldTime.getMonth() + 1)}-${pad(oldTime.getDate())} ${pad(oldTime.getHours())}:${pad(oldTime.getMinutes())}:${pad(oldTime.getSeconds())}`;

    db.db.prepare(`UPDATE conversation_state SET updated_at = ? WHERE id = ?`).run(oldStr, first.session.id);

    const second = db.getConversationState();
    expect(second.isNew).toBe(true);
    expect(second.session.id).not.toBe(first.session.id);
  });

  it("updateConversationState increments turns and tracks modes", () => {
    const result = db.updateConversationState("correction");
    expect(result.turn_count).toBe(1);
    expect(result.last_two_modes).toEqual(["correction"]);

    const result2 = db.updateConversationState("chat");
    expect(result2.turn_count).toBe(2);
    expect(result2.last_two_modes).toEqual(["correction", "chat"]);

    const result3 = db.updateConversationState("quiz");
    expect(result3.last_two_modes).toEqual(["chat", "quiz"]);
  });

  it("updateConversationState tracks topics", () => {
    db.updateConversationState("chat", "food");
    const result = db.updateConversationState("chat", "travel");
    expect(result.topics_touched).toContain("food");
    expect(result.topics_touched).toContain("travel");
  });

  it("updateConversationState does not duplicate topics", () => {
    db.updateConversationState("chat", "food");
    db.updateConversationState("chat", "food");
    const state = db.getConversationState();
    const topics: string[] = JSON.parse(state.session.topics_touched);
    expect(topics.filter((t) => t === "food")).toHaveLength(1);
  });

  it("updateConversationState sets mood hint", () => {
    db.updateConversationState("chat", undefined, "curious");
    const state = db.getConversationState();
    expect(state.session.mood_hint).toBe("curious");
  });
});

describe("BuddyDb interests", () => {
  it("addInterest inserts new interest and returns true", () => {
    const result = db.addInterest("cooking", "conversation", 0.8);
    expect(result).toBe(true);
  });

  it("addInterest returns false on duplicate (case-insensitive update)", () => {
    db.addInterest("Cooking", "conversation", 0.8);
    const result = db.addInterest("cooking", "explicit", 0.9);
    expect(result).toBe(false);

    const interests = db.listInterests(10);
    expect(interests).toHaveLength(1);
    expect(interests[0]).toBe("Cooking");
  });

  it("listInterests returns interests ordered by last_seen_at desc", () => {
    db.addInterest("music", "conversation", 0.7);
    db.addInterest("sports", "explicit", 0.6);
    const interests = db.listInterests(10);
    expect(interests).toHaveLength(2);
  });

  it("listInterests respects limit", () => {
    for (let i = 0; i < 5; i++) {
      db.addInterest(`interest${i}`, "conversation", 0.5);
    }
    const interests = db.listInterests(3);
    expect(interests).toHaveLength(3);
  });
});

describe("BuddyDb assessments", () => {
  it("insertAssessment and getLatestAssessment", () => {
    db.insertAssessment("A2", 0.7, "verb_tenses", "casa,perro", "ser/estar", "vocabulary", 10);
    const assessment = db.getLatestAssessment();
    expect(assessment).not.toBeNull();
    expect(assessment!.cefr_level).toBe("A2");
    expect(assessment!.confidence).toBe(0.7);
    expect(assessment!.sample_count).toBe(10);
  });

  it("getLatestAssessment returns null when empty", () => {
    expect(db.getLatestAssessment()).toBeNull();
  });
});

describe("BuddyDb export and progress", () => {
  it("exportVocab CSV format", () => {
    db.addVocab("gato", "cat", "ctx");
    db.addVocab("perro", "dog", "ctx");
    const result = db.exportVocab("csv");
    expect(result.count).toBe(2);
    expect(result.data).toContain("word,translation");
    expect(result.data).toContain("gato,cat");
    expect(result.data).toContain("perro,dog");
  });

  it("exportVocab markdown format", () => {
    db.addVocab("gato", "cat", "ctx");
    const result = db.exportVocab("markdown");
    expect(result.count).toBe(1);
    expect(result.data).toContain("**gato**");
  });

  it("progressSummary returns correct counts", () => {
    db.addVocab("gato", "cat", "ctx");
    db.addVocab("perro", "dog", "ctx");
    db.addVocab("casa", "house", "ctx");

    const summary = db.progressSummary();
    expect(summary.newCount).toBe(3);
    expect(summary.totalCount).toBe(3);
    expect(summary.dueCount).toBe(3);
    expect(summary.learningCount).toBe(0);
  });

  it("progressSummary tracks error categories", () => {
    db.logError("la gata", "el gato", "gender", "");
    db.logError("yo es", "yo soy", "verb_conjugation", "");
    db.logError("a escuela", "a la escuela", "gender", "");

    const summary = db.progressSummary();
    expect(summary.errorCategories["gender"]).toBe(2);
    expect(summary.errorCategories["verb_conjugation"]).toBe(1);
  });

  it("progressSummary recentWords", () => {
    db.addVocab("gato", "cat", "ctx");
    db.addVocab("perro", "dog", "ctx");
    const summary = db.progressSummary();
    expect(summary.recentWords).toHaveLength(2);
  });
});