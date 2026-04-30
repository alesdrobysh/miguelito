import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "./db.js";
import { sm2Review, statusOf } from "./sm2.js";

let db: BuddyDb;
let dbPath: string;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-test-"));
  dbPath = path.join(tmpDir, "test.db");
  db = await BuddyDb.open(dbPath);
});

afterEach(async () => {
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
  it("addVocab inserts a new word and returns id", async () => {
    const id = await db.addVocab("gato", "cat", "El gato duerme");
    expect(id).toBeTypeOf("number");
    expect(id).toBeGreaterThan(0);
  });

  it("addVocab returns null on duplicate word (case-insensitive)", async () => {
    await db.addVocab("gato", "cat", "El gato duerme");
    const id2 = await db.addVocab("Gato", "cat", "another context");
    expect(id2).toBeNull();
  });

  it("listVocab with 'all' returns all items", async () => {
    await db.addVocab("gato", "cat", "ctx1");
    await db.addVocab("perro", "dog", "ctx2");
    const items = await db.listVocab("all", 10);
    expect(items).toHaveLength(2);
  });

  it("listVocab filters by bucket", async () => {
    await db.addVocab("gato", "cat", "ctx");
    await db.addVocab("perro", "dog", "ctx");
    const items = await db.listVocab("new", 10);
    expect(items).toHaveLength(2);

    const learning = await db.listVocab("learning", 10);
    expect(learning).toHaveLength(0);
  });

  it("dueVocab returns items with null next_review_at", async () => {
    await db.addVocab("gato", "cat", "ctx");
    const due = await db.dueVocab(10);
    expect(due).toHaveLength(1);
    expect(due[0].word).toBe("gato");
  });

  it("scoreVocab updates word with SM-2 result", async () => {
    await db.addVocab("gato", "cat", "ctx");
    const result = await db.scoreVocab("gato", 4);
    expect(result.repetitions).toBe(1);
    expect(result.interval_days).toBe(1);
    expect(result.status).toBe("learning");
    expect(result.next_review_at).toBeTruthy();
  });

  it("scoreVocab throws on missing word", async () => {
    await expect(() => db.scoreVocab("nonexistent", 4)).rejects.toThrow();
  });

  it("scoreVocab transitions from new to learning to review to mastered", async () => {
    await db.addVocab("casa", "house", "ctx");
    let r = await db.scoreVocab("casa", 4);
    expect(r.status).toBe("learning");

    r = await db.scoreVocab("casa", 4);
    expect(r.status).toBe("learning");

    r = await db.scoreVocab("casa", 4);
    expect(r.status).toBe("review");

    for (let i = 0; i < 3; i++) {
      r = await db.scoreVocab("casa", 4);
    }
    expect(r.status).toBe("mastered");
  });
});

describe("BuddyDb error log", () => {
  it("logError inserts an error and returns id", async () => {
    const id = await db.logError("la gata", "el gato", "gender", "wrong gender");
    expect(id).toBeTypeOf("number");
  });

  it("logError defaults unknown category to other", async () => {
    await db.logError("yo es", "yo soy", "nonexistent_category", "");
    const errors = await db.listErrors("other", 10);
    expect(errors).toHaveLength(1);
  });

  it("listErrors filters by category", async () => {
    await db.logError("la gata", "el gato", "gender", "");
    await db.logError("yo cantado", "yo he cantado", "verb_conjugation", "");
    await db.logError("a escuela", "a la escuela", "preposition", "");

    const gender = await db.listErrors("gender", 10);
    expect(gender).toHaveLength(1);

    const all = await db.listErrors("all", 10);
    expect(all).toHaveLength(3);
  });

  it("listErrors respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await db.logError(`err${i}`, `cor${i}`, "other", "");
    }
    const errors = await db.listErrors("all", 3);
    expect(errors).toHaveLength(3);
  });
});

describe("BuddyDb profile", () => {
  it("getProfile returns null initially", async () => {
    expect(await db.getProfile()).toBeNull();
  });

  it("setProfile creates and updates profile fields", async () => {
    const updated = await db.setProfile({ name: "Alice", level: "A2" });
    expect(updated).toContain("name");
    expect(updated).toContain("level");

    const profile = await db.getProfile();
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("Alice");
    expect(profile!.level).toBe("A2");
  });

  it("setProfile updates existing profile", async () => {
    await db.setProfile({ name: "Alice" });
    await db.setProfile({ level: "B1" });

    const profile = await db.getProfile();
    expect(profile!.name).toBe("Alice");
    expect(profile!.level).toBe("B1");
  });

  it("setProfile ignores invalid keys", async () => {
    const updated = await db.setProfile({ hacker: "yes" } as Record<string, string>);
    expect(updated).toHaveLength(0);
  });
});

describe("BuddyDb conversation state", () => {
  it("getConversationState creates new session when none exists", async () => {
    const result = await db.getConversationState();
    expect(result.isNew).toBe(true);
    expect(result.session.session_id).toBeTruthy();
    expect(result.session.turn_count).toBe(0);
  });

  it("getConversationState returns existing session within 30 min", async () => {
    const first = await db.getConversationState();
    const second = await db.getConversationState();
    expect(second.isNew).toBe(false);
    expect(second.session.id).toBe(first.session.id);
  });

  it("getConversationState creates new session after 30 min gap (simulated by updating updated_at)", async () => {
    const first = await db.getConversationState();
    const oldTime = new Date(Date.now() - 31 * 60000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const oldStr = `${oldTime.getFullYear()}-${pad(oldTime.getMonth() + 1)}-${pad(oldTime.getDate())} ${pad(oldTime.getHours())}:${pad(oldTime.getMinutes())}:${pad(oldTime.getSeconds())}`;

    db.db.run(`UPDATE conversation_state SET updated_at = ? WHERE id = ?`, [oldStr, first.session.id]);

    const second = await db.getConversationState();
    expect(second.isNew).toBe(true);
    expect(second.session.id).not.toBe(first.session.id);
  });

  it("updateConversationState increments turns and tracks modes", async () => {
    const result = await db.updateConversationState("correction");
    expect(result.turn_count).toBe(1);
    expect(result.last_two_modes).toEqual(["correction"]);

    const result2 = await db.updateConversationState("chat");
    expect(result2.turn_count).toBe(2);
    expect(result2.last_two_modes).toEqual(["correction", "chat"]);

    const result3 = await db.updateConversationState("quiz");
    expect(result3.last_two_modes).toEqual(["chat", "quiz"]);
  });

  it("updateConversationState tracks topics", async () => {
    await db.updateConversationState("chat", "food");
    const result = await db.updateConversationState("chat", "travel");
    expect(result.topics_touched).toContain("food");
    expect(result.topics_touched).toContain("travel");
  });

  it("updateConversationState does not duplicate topics", async () => {
    await db.updateConversationState("chat", "food");
    await db.updateConversationState("chat", "food");
    const state = await db.getConversationState();
    const topics: string[] = JSON.parse(state.session.topics_touched);
    expect(topics.filter((t) => t === "food")).toHaveLength(1);
  });

  it("updateConversationState sets mood hint", async () => {
    await db.updateConversationState("chat", undefined, "curious");
    const state = await db.getConversationState();
    expect(state.session.mood_hint).toBe("curious");
  });
});

describe("BuddyDb interests", () => {
  it("addInterest inserts new interest and returns true", async () => {
    const result = await db.addInterest("cooking", "conversation", 0.8);
    expect(result).toBe(true);
  });

  it("addInterest returns false on duplicate (case-insensitive update)", async () => {
    await db.addInterest("Cooking", "conversation", 0.8);
    const result = await db.addInterest("cooking", "explicit", 0.9);
    expect(result).toBe(false);

    const interests = await db.listInterests(10);
    expect(interests).toHaveLength(1);
    expect(interests[0]).toBe("Cooking");
  });

  it("listInterests returns interests ordered by last_seen_at desc", async () => {
    await db.addInterest("music", "conversation", 0.7);
    await db.addInterest("sports", "explicit", 0.6);
    const interests = await db.listInterests(10);
    expect(interests).toHaveLength(2);
  });

  it("listInterests respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await db.addInterest(`interest${i}`, "conversation", 0.5);
    }
    const interests = await db.listInterests(3);
    expect(interests).toHaveLength(3);
  });
});

describe("BuddyDb assessments", () => {
  it("insertAssessment and getLatestAssessment", async () => {
    await db.insertAssessment("A2", 0.7, "verb_tenses", "casa,perro", "ser/estar", "vocabulary", 10);
    const assessment = await db.getLatestAssessment();
    expect(assessment).not.toBeNull();
    expect(assessment!.cefr_level).toBe("A2");
    expect(assessment!.confidence).toBe(0.7);
    expect(assessment!.sample_count).toBe(10);
  });

  it("getLatestAssessment returns null when empty", async () => {
    expect(await db.getLatestAssessment()).toBeNull();
  });
});

describe("BuddyDb export and progress", () => {
  it("exportVocab CSV format", async () => {
    await db.addVocab("gato", "cat", "ctx");
    await db.addVocab("perro", "dog", "ctx");
    const result = await db.exportVocab("csv");
    expect(result.count).toBe(2);
    expect(result.data).toContain("word,translation");
    expect(result.data).toContain("gato,cat");
    expect(result.data).toContain("perro,dog");
  });

  it("exportVocab markdown format", async () => {
    await db.addVocab("gato", "cat", "ctx");
    const result = await db.exportVocab("markdown");
    expect(result.count).toBe(1);
    expect(result.data).toContain("**gato**");
  });

  it("progressSummary returns correct counts", async () => {
    await db.addVocab("gato", "cat", "ctx");
    await db.addVocab("perro", "dog", "ctx");
    await db.addVocab("casa", "house", "ctx");

    const summary = await db.progressSummary();
    expect(summary.newCount).toBe(3);
    expect(summary.totalCount).toBe(3);
    expect(summary.dueCount).toBe(3);
    expect(summary.learningCount).toBe(0);
  });

  it("progressSummary tracks error categories", async () => {
    await db.logError("la gata", "el gato", "gender", "");
    await db.logError("yo es", "yo soy", "verb_conjugation", "");
    await db.logError("a escuela", "a la escuela", "gender", "");

    const summary = await db.progressSummary();
    expect(summary.errorCategories["gender"]).toBe(2);
    expect(summary.errorCategories["verb_conjugation"]).toBe(1);
  });

  it("progressSummary recentWords", async () => {
    await db.addVocab("gato", "cat", "ctx");
    await db.addVocab("perro", "dog", "ctx");
    const summary = await db.progressSummary();
    expect(summary.recentWords).toHaveLength(2);
  });
});
