import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "./infrastructure/db.js";
import { SpanishLanguage } from "./languages/spanish/index.js";

const lang = SpanishLanguage;

function scopedDb(shared: BuddyDb, userId: number): BuddyDb {
  return shared.withUserId(userId).withLanguage(lang.id, lang.errorCategories, lang.morphologyCategories);
}

describe("e2e user isolation", () => {
  let tmpDir: string;
  let dbPath: string;
  let shared: BuddyDb;
  let user2: BuddyDb;
  let user3: BuddyDb;

  afterEach(() => {
    try { user3?.close?.(); } catch {}
    try { user2?.close?.(); } catch {}
    try { shared?.close?.(); } catch {}
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-iso-"));
    dbPath = path.join(tmpDir, "test.db");
    shared = await BuddyDb.open(dbPath, lang.id, lang.errorCategories, lang.morphologyCategories);
    await shared.ensureExternalUser("telegram", "user-b");
    await shared.ensureExternalUser("telegram", "user-c");
    user2 = scopedDb(shared, 2);
    user3 = scopedDb(shared, 3);
  }

  it("creates separate user rows", async () => {
    await setup();
    const rows = shared.db.exec("SELECT id, platform, external_user_id FROM users ORDER BY id")[0]?.values ?? [];
    expect(rows.map(r => [r[0], r[1], r[2]])).toEqual([
      [1, "local", "default"],
      [2, "telegram", "user-b"],
      [3, "telegram", "user-c"],
    ]);
  });

  it("isolates chat_history per user", async () => {
    await setup();
    await user2.addChatMessage(111, "user", "hola user2");
    await user3.addChatMessage(222, "user", "hola user3");

    const hist2 = await user2.getChatHistory(111, 10);
    const hist3 = await user3.getChatHistory(222, 10);
    expect(hist2.map(m => m.content)).toEqual(["hola user2"]);
    expect(hist3.map(m => m.content)).toEqual(["hola user3"]);

    const raw = shared.db.exec("SELECT user_id, content FROM chat_history ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, "hola user2"], [3, "hola user3"]]);
  });

  it("isolates conversation_state per user", async () => {
    await setup();
    const s2 = await user2.getConversationState();
    const s3 = await user3.getConversationState();
    expect(s2.session.session_id).toBeTruthy();
    expect(s3.session.session_id).toBeTruthy();
    expect(s2.session.session_id).not.toBe(s3.session.session_id);

    const rows = shared.db.exec("SELECT user_id, session_id FROM conversation_state ORDER BY user_id")[0]?.values ?? [];
    expect(rows.map(r => r[0])).toEqual([2, 3]);
  });

  it("isolates learning_items per user", async () => {
    await setup();
    await user2.addLearningItem({ type: "phrase", title: "item-2", explanation_l1: "for user 2", source_type: "imported", priority: 0.9 });
    await user3.addLearningItem({ type: "phrase", title: "item-3", explanation_l1: "for user 3", source_type: "imported", priority: 0.9 });

    const items2 = await user2.listLearningItems("active", 10);
    const items3 = await user3.listLearningItems("active", 10);
    expect(items2.map(i => i.title)).toContain("item-2");
    expect(items2.map(i => i.title)).not.toContain("item-3");
    expect(items3.map(i => i.title)).toContain("item-3");
    expect(items3.map(i => i.title)).not.toContain("item-2");

    const raw = shared.db.exec("SELECT user_id, title FROM learning_items ORDER BY user_id, title")[0]?.values ?? [];
    expect(raw).toEqual([[2, "item-2"], [3, "item-3"]]);
  });

  it("isolates learning_item_evidence per user", async () => {
    await setup();
    const id2 = (await user2.addLearningItem({ type: "phrase", title: "ev2", source_type: "imported", priority: 0.9 }))!;
    const id3 = (await user3.addLearningItem({ type: "phrase", title: "ev3", source_type: "imported", priority: 0.9 }))!;

    await user2.recordLearningItemEvidence({ learning_item_id: id2, skill: "passive", event: "understood", independence: "elicited", score_delta: 0.1, source_type: "conversation" });
    await user3.recordLearningItemEvidence({ learning_item_id: id3, skill: "active", event: "produced", independence: "spontaneous", score_delta: 0.2, source_type: "conversation" });

    const ev2 = await user2.listLearningItemEvidence(id2, 10);
    const ev3 = await user3.listLearningItemEvidence(id3, 10);
    expect(ev2).toHaveLength(1);
    expect(ev3).toHaveLength(1);
    expect(ev2[0].event).toBe("understood");
    expect(ev3[0].event).toBe("produced");

    const ev2for3 = await user2.listLearningItemEvidence(id3, 10);
    expect(ev2for3).toHaveLength(0);
  });

  it("isolates learning_practice_attempts per user", async () => {
    await setup();
    const id2 = (await user2.addLearningItem({ type: "phrase", title: "prac2", source_type: "imported", priority: 0.9 }))!;
    const id3 = (await user3.addLearningItem({ type: "phrase", title: "prac3", source_type: "imported", priority: 0.9 }))!;

    await user2.startLearningPracticeAttempt({ learning_item_id: id2, prompt_text: "Use prac2" });
    await user3.startLearningPracticeAttempt({ learning_item_id: id3, prompt_text: "Use prac3" });

    const att2 = await user2.listActiveLearningPracticeAttempts(10);
    const att3 = await user3.listActiveLearningPracticeAttempts(10);
    expect(att2).toHaveLength(1);
    expect(att3).toHaveLength(1);
    expect(att2[0].learning_item_id).toBe(id2);
    expect(att3[0].learning_item_id).toBe(id3);

    const raw = shared.db.exec("SELECT user_id, learning_item_id FROM learning_practice_attempts ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, id2], [3, id3]]);
  });

  it("isolates error_log per user", async () => {
    await setup();
    await user2.logError("err user2", "correct2", "grammar", "note2");
    await user3.logError("err user3", "correct3", "vocabulary", "note3");

    const e2 = await user2.listErrors("all", 10);
    const e3 = await user3.listErrors("all", 10);
    expect(e2.map(e => e.user_text)).toContain("err user2");
    expect(e2.map(e => e.user_text)).not.toContain("err user3");
    expect(e3.map(e => e.user_text)).toContain("err user3");
    expect(e3.map(e => e.user_text)).not.toContain("err user2");

    const raw = shared.db.exec("SELECT user_id, user_text FROM error_log ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, "err user2"], [3, "err user3"]]);
  });

  it("isolates user_profile per user", async () => {
    await setup();
    await user2.setProfile({ name: "User Two", goal: "fluency" });
    await user3.setProfile({ name: "User Three", goal: "travel" });

    const p2 = await user2.getProfile();
    const p3 = await user3.getProfile();
    expect(p2?.name).toBe("User Two");
    expect(p3?.name).toBe("User Three");

    const raw = shared.db.exec("SELECT user_id, name, goal FROM user_profile ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, "User Two", "fluency"], [3, "User Three", "travel"]]);
  });

  it("isolates turn_annotations per user", async () => {
    await setup();
    await user2.insertTurnAnnotation({ session_id: "s2", turn_number: 1, obligatory: [], used: [], naturalness: 0.5, comprehension: "smooth", tunit_length: 5, had_subordination: false, lexical_rarity: 0, self_correction: false });
    await user3.insertTurnAnnotation({ session_id: "s3", turn_number: 1, obligatory: [], used: [], naturalness: 0.8, comprehension: "smooth", tunit_length: 8, had_subordination: true, lexical_rarity: 0, self_correction: false });

    const a2 = await user2.getRecentAnnotations(10);
    const a3 = await user3.getRecentAnnotations(10);
    expect(a2).toHaveLength(1);
    expect(a3).toHaveLength(1);
    expect(a2[0].session_id).toBe("s2");
    expect(a3[0].session_id).toBe("s3");

    const raw = shared.db.exec("SELECT user_id, session_id FROM turn_annotations ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, "s2"], [3, "s3"]]);
  });

  it("isolates competency_vector per user", async () => {
    await setup();
    const cv2 = await user2.getCompetencyVector();
    const cv3 = await user3.getCompetencyVector();
    expect(cv2.id).toBeTruthy();
    expect(cv3.id).toBeTruthy();
    expect(cv2.id).not.toBe(cv3.id);

    const raw = shared.db.exec("SELECT user_id, id FROM competency_vector WHERE language = ? ORDER BY user_id", [lang.id])[0]?.values ?? [];
    expect(raw.map(r => r[0])).toEqual([2, 3]);
  });

  it("isolates user_interests per user", async () => {
    await setup();
    await user2.addInterest("fútbol", "chat", 0.9);
    await user3.addInterest("cocina", "chat", 0.8);

    const i2 = await user2.listInterests(10);
    const i3 = await user3.listInterests(10);
    expect(i2).toContain("fútbol");
    expect(i2).not.toContain("cocina");
    expect(i3).toContain("cocina");
    expect(i3).not.toContain("fútbol");

    const raw = shared.db.exec("SELECT user_id, interest FROM user_interests ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, "fútbol"], [3, "cocina"]]);
  });

  it("isolates proficiency_evidence per user", async () => {
    await setup();
    await user2.insertProficiencyEvidence({ skill: "production", dimension: "fluency", challenge_band: "top_1k", outcome: "success", confidence: 0.7, weight: 1, evidence_text: "ev2" });
    await user3.insertProficiencyEvidence({ skill: "reception", dimension: "lexical", challenge_band: "top_6k", outcome: "partial", confidence: 0.6, weight: 1, evidence_text: "ev3" });

    const pe2 = await user2.listProficiencyEvidence(10);
    const pe3 = await user3.listProficiencyEvidence(10);
    expect(pe2.map(e => e.evidence_text)).toContain("ev2");
    expect(pe2.map(e => e.evidence_text)).not.toContain("ev3");
    expect(pe3.map(e => e.evidence_text)).toContain("ev3");
    expect(pe3.map(e => e.evidence_text)).not.toContain("ev2");

    const raw = shared.db.exec("SELECT user_id, evidence_text FROM proficiency_evidence ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, "ev2"], [3, "ev3"]]);
  });

  it("isolates _buddy_meta per user", async () => {
    await setup();
    await user2.setMetaValue("theme", "dark");
    await user3.setMetaValue("theme", "light");

    const m2 = await user2.getMetaValue("theme");
    const m3 = await user3.getMetaValue("theme");
    expect(m2).toBe("dark");
    expect(m3).toBe("light");

    const raw = shared.db.exec("SELECT user_id, key, value FROM _buddy_meta WHERE key = 'theme' ORDER BY user_id")[0]?.values ?? [];
    expect(raw).toEqual([[2, "theme", "dark"], [3, "theme", "light"]]);
  });

  it("keeps all scoped data isolated across users in a realistic flow", async () => {
    await setup();

    // User 2
    await user2.addChatMessage(111, "user", "Hola, quiero practicar", "s2");
    await user2.addChatMessage(111, "assistant", "¡Claro! ¿Sobre qué tema?", "s2");
    await user2.logError("practicar", "practicar", "spelling", "typo");
    await user2.setProfile({ name: "A", goal: "conversación" });
    await user2.addInterest("deportes", "chat", 0.9);
    const itemId2 = (await user2.addLearningItem({ type: "phrase", title: "tener ganas de", explanation_l1: "to feel like", source_type: "conversation", priority: 0.95 }))!;
    await user2.recordLearningItemEvidence({ learning_item_id: itemId2, skill: "passive", event: "understood", independence: "elicited", score_delta: 0.1, source_type: "conversation" });
    await user2.insertTurnAnnotation({ session_id: "s2", turn_number: 1, obligatory: [], used: [], naturalness: 0.5, comprehension: "smooth", tunit_length: 5, had_subordination: false, lexical_rarity: 0, self_correction: false });
    await user2.setMetaValue("last_active", "today");
    await user2.insertProficiencyEvidence({ skill: "production", dimension: "fluency", challenge_band: "top_1k", outcome: "success", confidence: 0.7, weight: 1, evidence_text: "used tener ganas de" });

    // User 3
    await user3.addChatMessage(222, "user", "Quiero aprender vocabulario", "s3");
    await user3.addChatMessage(222, "assistant", "Empecemos con comida", "s3");
    await user3.logError("vocabulario", "vocabulario", "spelling", "typo");
    await user3.setProfile({ name: "B", goal: "viaje" });
    await user3.addInterest("gastronomía", "chat", 0.8);
    const itemId3 = (await user3.addLearningItem({ type: "phrase", title: "dar un paseo", explanation_l1: "to take a walk", source_type: "conversation", priority: 0.95 }))!;
    await user3.recordLearningItemEvidence({ learning_item_id: itemId3, skill: "active", event: "produced", independence: "spontaneous", score_delta: 0.2, source_type: "conversation" });
    await user3.insertTurnAnnotation({ session_id: "s3", turn_number: 1, obligatory: [], used: [], naturalness: 0.8, comprehension: "smooth", tunit_length: 8, had_subordination: true, lexical_rarity: 0, self_correction: false });
    await user3.setMetaValue("last_active", "yesterday");
    await user3.insertProficiencyEvidence({ skill: "reception", dimension: "lexical", challenge_band: "top_6k", outcome: "partial", confidence: 0.6, weight: 1, evidence_text: "understood dar un paseo" });

    // Verify each table via raw SQL
    const verify = (table: string, col: string, extra = "", orderBy = "id") => {
      const r2 = shared.db.exec(`SELECT ${col} FROM ${table} WHERE user_id = 2 ${extra} ORDER BY ${orderBy}`)[0]?.values ?? [];
      const r3 = shared.db.exec(`SELECT ${col} FROM ${table} WHERE user_id = 3 ${extra} ORDER BY ${orderBy}`)[0]?.values ?? [];
      expect(r2.length, `${table}: user 2 has no rows`).toBeGreaterThan(0);
      expect(r3.length, `${table}: user 3 has no rows`).toBeGreaterThan(0);
    };

    verify("chat_history", "content");
    verify("error_log", "user_text");
    verify("user_profile", "name");
    verify("user_interests", "interest");
    verify("learning_items", "title");
    verify("learning_item_evidence", "event");
    verify("turn_annotations", "session_id");
    verify("proficiency_evidence", "evidence_text");
    verify("_buddy_meta", "key", "AND key = 'last_active'", "key");

    // Cross-read isolation via repository methods
    const hist2 = await user2.getChatHistory(111, 10);
    expect(hist2.some(m => m.content.includes("comida"))).toBe(false);
    expect(hist2.some(m => m.content.includes("practicar"))).toBe(true);

    const hist3 = await user3.getChatHistory(222, 10);
    expect(hist3.some(m => m.content.includes("practicar"))).toBe(false);
    expect(hist3.some(m => m.content.includes("comida"))).toBe(true);

    expect((await user2.listErrors("all", 10)).some(e => e.user_text.includes("vocabulario"))).toBe(false);
    expect((await user3.listErrors("all", 10)).some(e => e.user_text.includes("practicar"))).toBe(false);

    expect(await user2.listInterests(10)).not.toContain("gastronomía");
    expect(await user3.listInterests(10)).not.toContain("deportes");

    expect((await user2.listLearningItems("active", 10)).map(i => i.title)).not.toContain("dar un paseo");
    expect((await user3.listLearningItems("active", 10)).map(i => i.title)).not.toContain("tener ganas de");

    expect((await user2.listProficiencyEvidence(10)).map(e => e.evidence_text)).not.toContain("understood dar un paseo");
    expect((await user3.listProficiencyEvidence(10)).map(e => e.evidence_text)).not.toContain("used tener ganas de");

    expect(await user2.getMetaValue("last_active")).toBe("today");
    expect(await user3.getMetaValue("last_active")).toBe("yesterday");
  });
});
