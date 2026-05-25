import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { BuddyDb } from "./infrastructure/db.js";
import { getCompetencyVector } from "./domain/competency.js";
import { createTestDb, type TestDbHandle } from "./test/dbHelpers.js";

let db: BuddyDb;
let handle: TestDbHandle;

beforeEach(async () => {
  handle = await createTestDb();
  db = handle.db;
});

afterEach(() => {
  handle.cleanup();
});

describe("BuddyDb vocabulary (chunk-based)", () => {
  it("addVocab inserts a chunk and returns id", async () => {
    const id = await db.addVocab("echar de menos", "te echo de menos, amigo", "echar");
    expect(id).toBeTypeOf("number");
    expect(id).toBeGreaterThan(0);
  });

  it("addVocab returns null on duplicate (case-insensitive)", async () => {
    await db.addVocab("echar de menos", "ctx");
    const id2 = await db.addVocab("ECHAR DE MENOS", "ctx2");
    expect(id2).toBeNull();
  });

  it("addVocab stores anchor", async () => {
    await db.addVocab("me cuesta + [inf]", "me cuesta hablar", "costar");
    const items = await db.listVocab("all", 10);
    const item = items.find((i) => i.chunk_l2 === "me cuesta + [inf]");
    expect(item).toBeDefined();
    expect(item!.anchor).toBe("costar");
  });

  it("addVocab without anchor stores null anchor", async () => {
    await db.addVocab("gato", "el gato es negro");
    const items = await db.listVocab("all", 10);
    expect(items[0].anchor).toBeNull();
  });

  it("listVocab with 'all' returns all items", async () => {
    await db.addVocab("echar de menos", "ctx");
    await db.addVocab("tener en cuenta", "ctx");
    const items = await db.listVocab("all", 10);
    expect(items).toHaveLength(2);
  });

  it("listVocab filters by bucket 'new'", async () => {
    await db.addVocab("gato", "ctx");
    await db.addVocab("perro", "ctx");
    const items = await db.listVocab("new", 10);
    expect(items).toHaveLength(2);
    const learning = await db.listVocab("learning", 10);
    expect(learning).toHaveLength(0);
  });

  it("dueVocab returns new items (pro_due IS NULL)", async () => {
    await db.addVocab("echar de menos", "ctx");
    const due = await db.dueVocab(10);
    expect(due).toHaveLength(1);
    expect(due[0].chunk_l2).toBe("echar de menos");
  });

  it("dueVocab can select receptive due items independently of productive schedule", async () => {
    await db.addVocab("echar de menos", "ctx");
    await db.scoreVocab("echar de menos", 3, "receptive");

    const productiveDue = await db.dueVocab(10, "productive");
    const receptiveDue = await db.dueVocab(10, "receptive");

    expect(productiveDue.map((r) => r.chunk_l2)).toContain("echar de menos");
    expect(receptiveDue.map((r) => r.chunk_l2)).not.toContain("echar de menos");
  });

  it("scoreVocab defaults to productive mode", async () => {
    await db.addVocab("llevar a cabo", "ctx");
    const r = await db.scoreVocab("llevar a cabo", 3);
    expect(r.reps).toBe(1);
    expect(r.stability).toBeGreaterThan(0);
    expect(r.due).toBeTruthy();
  });

  it("scoreVocab productive updates pro_ columns only", async () => {
    await db.addVocab("dar un paseo", "ctx");
    await db.scoreVocab("dar un paseo", 4, "productive");
    const rows = db.db.exec(
      `SELECT pro_reps, pro_stability, rec_reps, rec_stability FROM vocabulary_items WHERE chunk_l2 = 'dar un paseo'`
    );
    const [proReps, proS, recReps, recS] = rows[0].values[0];
    expect(proReps).toBe(1);
    expect(proS).toBeGreaterThan(1);
    expect(recReps).toBe(0);
    expect(recS).toBe(1.0); // untouched default
  });

  it("scoreVocab receptive updates rec_ columns only", async () => {
    await db.addVocab("poner la mesa", "ctx");
    await db.scoreVocab("poner la mesa", 4, "receptive");
    const rows = db.db.exec(
      `SELECT pro_reps, pro_stability, rec_reps, rec_stability FROM vocabulary_items WHERE chunk_l2 = 'poner la mesa'`
    );
    const [proReps, proS, recReps, recS] = rows[0].values[0];
    expect(proReps).toBe(0);
    expect(proS).toBe(1.0); // untouched default
    expect(recReps).toBe(1);
    expect(recS).toBeGreaterThan(1);
  });

  it("productive and receptive counters advance independently", async () => {
    await db.addVocab("hacer caso", "ctx");
    await db.scoreVocab("hacer caso", 4, "productive");
    await db.scoreVocab("hacer caso", 4, "productive");
    await db.scoreVocab("hacer caso", 5 as any, "receptive"); // grade clamped to 4
    const rows = db.db.exec(
      `SELECT pro_reps, rec_reps FROM vocabulary_items WHERE chunk_l2 = 'hacer caso'`
    );
    const [proReps, recReps] = rows[0].values[0];
    expect(proReps).toBe(2);
    expect(recReps).toBe(1);
  });

  it("scoreVocab grade=1 (Again) resets reps to 0", async () => {
    await db.addVocab("tener en cuenta", "ctx");
    await db.scoreVocab("tener en cuenta", 3, "productive");
    const r = await db.scoreVocab("tener en cuenta", 1, "productive");
    expect(r.reps).toBe(0);
    expect(r.status).toBe("new");
  });

  it("scoreVocab throws on missing chunk", async () => {
    await expect(() => db.scoreVocab("nonexistent chunk", 3)).rejects.toThrow();
  });

  it("stages evaluator vocabulary as candidates before active SRS promotion", async () => {
    const id = await db.addVocabCandidate({
      chunk_l2: "despejar la mente",
      anchor: "despejar",
      capture_context_l2: "Necesito despejar la mente.",
      source_type: "conversation",
      evidence_snippet: "learner asked what it means",
      priority: 0.88,
      promotion_reason: "personally relevant and conversationally useful",
    });

    expect(id).toBeTypeOf("number");
    expect(await db.listVocab("all", 10)).toHaveLength(0);
    const candidates = await db.listVocabCandidates("candidate", 10);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ chunk_l2: "despejar la mente", status: "candidate", source_type: "conversation" });
  });

  it("dedupes candidates against active vocabulary and existing candidates", async () => {
    await db.addVocab("desconectar de verdad", "ctx", "desconectar");
    const activeDup = await db.addVocabCandidate({ chunk_l2: "Desconectar De Verdad", source_type: "conversation", priority: 0.9 });
    const first = await db.addVocabCandidate({ chunk_l2: "aprovechar el trayecto", source_type: "conversation", priority: 0.8 });
    const second = await db.addVocabCandidate({ chunk_l2: "APROVECHAR EL TRAYECTO", source_type: "conversation", priority: 0.9 });

    expect(activeDup).toBeNull();
    expect(first).toBeTypeOf("number");
    expect(second).toBeNull();
    expect(await db.listVocabCandidates("candidate", 10)).toHaveLength(1);
  });

  it("promotes a bounded number of high-priority candidates to active vocabulary", async () => {
    await db.addVocabCandidate({ chunk_l2: "chunk low", source_type: "conversation", priority: 0.2 });
    await db.addVocabCandidate({ chunk_l2: "chunk high one", anchor: "one", capture_context_l2: "ctx1", source_type: "correction", priority: 0.95 });
    await db.addVocabCandidate({ chunk_l2: "chunk high two", anchor: "two", capture_context_l2: "ctx2", source_type: "conversation", priority: 0.9 });

    const promoted = await db.promoteVocabCandidates({ maxPromotions: 1, minPriority: 0.75, maxActiveLearningItems: 40 });

    expect(promoted.map((p) => p.chunk_l2)).toEqual(["chunk high one"]);
    expect((await db.listVocab("all", 10)).map((v) => v.chunk_l2)).toEqual(["chunk high one"]);
    const candidates = await db.listVocabCandidates("all", 10);
    expect(candidates.find((c) => c.chunk_l2 === "chunk high one")?.status).toBe("accepted");
    expect(candidates.find((c) => c.chunk_l2 === "chunk high two")?.status).toBe("candidate");
  });

  it("does not promote candidates when the active learning backlog is full", async () => {
    await db.addVocab("already active", "ctx");
    await db.addVocabCandidate({ chunk_l2: "good candidate", source_type: "conversation", priority: 0.99 });

    const promoted = await db.promoteVocabCandidates({ maxPromotions: 3, minPriority: 0.75, maxActiveLearningItems: 1 });

    expect(promoted).toHaveLength(0);
    expect((await db.listVocab("all", 10)).map((v) => v.chunk_l2)).toEqual(["already active"]);
  });

  it("records and completes a productive vocabulary review attempt", async () => {
    await db.addVocab("me cuesta + [inf]", "ctx", "costar");
    const attempt = await db.startVocabReviewAttempt({
      word: "me cuesta + [inf]",
      mode: "productive",
      strategy: "personal_question",
      prompt_text: "¿Qué te cuesta hacer por la mañana?",
      hint_level: 0,
    });

    expect(attempt.id).toBeGreaterThan(0);
    expect(attempt.status).toBe("active");

    const completed = await db.finishVocabReviewAttempt({
      attempt_id: attempt.id,
      user_response: "Me cuesta levantarme temprano.",
      target_used: true,
      accepted_variant: "me cuesta levantarme",
      hint_level: 0,
      grade: 3,
      note: "spontaneous accurate production",
    });

    expect(completed.status).toBe("completed");
    expect(completed.grade).toBe(3);
    const rows = db.db.exec(`SELECT pro_reps, rec_reps FROM vocabulary_items WHERE chunk_l2 = 'me cuesta + [inf]'`);
    expect(rows[0].values[0]).toEqual([1, 0]);
  });

  it("reuses an active vocabulary review attempt instead of creating duplicates", async () => {
    await db.addVocab("coger el tren", "ctx", "coger");
    const first = await db.startVocabReviewAttempt({
      word: "coger el tren",
      mode: "productive",
      strategy: "cloze",
      prompt_text: "Completa: tengo que ___",
    });
    const second = await db.startVocabReviewAttempt({
      word: "coger el tren",
      mode: "productive",
      strategy: "personal_question",
      prompt_text: "¿Cuándo coges el tren?",
    });

    expect(second.id).toBe(first.id);
    const active = await db.listActiveVocabReviewAttempts(10);
    expect(active.map((a) => a.word)).toEqual(["coger el tren"]);
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
    const updated = await db.setProfile({ name: "Alice", goal: "travel" });
    expect(updated).toContain("name");
    expect(updated).toContain("goal");

    const profile = await db.getProfile();
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("Alice");
    expect(profile!.goal).toBe("travel");
  });

  it("setProfile updates existing profile", async () => {
    await db.setProfile({ name: "Alice" });
    await db.setProfile({ goal: "conversation" });

    const profile = await db.getProfile();
    expect(profile!.name).toBe("Alice");
    expect(profile!.goal).toBe("conversation");
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

  it("getConversationState creates new session after 30 min gap", async () => {
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

describe("BuddyDb export and progress", () => {
  it("exportVocab CSV format", async () => {
    await db.addVocab("echar de menos", "ctx", "echar");
    await db.addVocab("tener en cuenta", "ctx", "tener");
    const result = await db.exportVocab("csv");
    expect(result.count).toBe(2);
    expect(result.data).toContain("chunk_l2,anchor");
    expect(result.data).toContain("echar de menos");
    expect(result.data).toContain("tener en cuenta");
  });

  it("exportVocab markdown format", async () => {
    await db.addVocab("echar de menos", "ctx", "echar");
    const result = await db.exportVocab("markdown");
    expect(result.count).toBe(1);
    expect(result.data).toContain("**echar de menos**");
  });

  it("progressSummary returns correct counts", async () => {
    await db.addVocab("gato", "ctx");
    await db.addVocab("perro", "ctx");
    await db.addVocab("casa", "ctx");

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

  it("progressSummary recentWords returns chunk_l2 values", async () => {
    await db.addVocab("echar de menos", "ctx");
    await db.addVocab("dar un paseo", "ctx");
    const summary = await db.progressSummary();
    expect(summary.recentWords).toHaveLength(2);
    expect(summary.recentWords).toContain("echar de menos");
  });
});

describe("BuddyDb turn annotations and competency vector", () => {
  it("schema v5: turn_annotations and competency_vector tables exist", async () => {
    const tables = db.db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const names = tables[0].values.map((r) => r[0] as string);
    expect(names).toContain("turn_annotations");
    expect(names).toContain("competency_vector");

    const ver = db.db.exec("SELECT value FROM _buddy_meta WHERE key = 'schema_version'");
    expect(ver[0].values[0][0]).toBe("10");
  });

  it("competency_vector row is seeded with defaults", async () => {
    const vec = await db.getCompetencyVector();
    expect(vec.id).toBeTypeOf("number");
    expect(vec.morph_successes).toBe(0.5);
    expect(vec.morph_trials).toBe(1.0);
    expect(vec.morph_obs).toBe(0);
    expect(vec.reception_ewma).toBe(0.5);
  });

  it("insertTurnAnnotation with morphology obligatory contexts updates EWMA correctly", async () => {
    // Pre-log a morphology error so the EWMA numerator reads it
    await db.logError("yo soy buena", "yo soy bueno", "agreement", "gender agreement");

    const vecBefore = await db.getCompetencyVector();
    const sBefore = vecBefore.morph_successes;
    const tBefore = vecBefore.morph_trials;

    await db.insertTurnAnnotation({
      obligatory: [{ type: "agreement" }, { type: "verb_conjugation" }],
      used: ["present tense"],
      comprehension: "smooth",
      naturalness: 0.8,
      tunit_length: 2,
      had_subordination: false,
    });

    const vec = await db.getCompetencyVector();
    // After decay + 2 obligatory + 1 error → successes incremented by 1 (not 2)
    // trials decayed + 2, successes decayed + 1
    expect(vec.morph_trials).toBeGreaterThan(tBefore);
    expect(vec.morph_successes).toBeLessThan(vec.morph_trials);  // rate < 1 (had an error)
    expect(vec.morph_obs).toBe(1);
    expect(vec.idiom_obs).toBe(1);  // naturalness was provided
  });

  it("successive turns without morphology data decay the counters", async () => {
    const vecInitial = await db.getCompetencyVector();
    const trialsBefore = vecInitial.morph_trials;

    for (let i = 0; i < 10; i++) {
      await db.insertTurnAnnotation({
        obligatory: [],  // no morphology obligatory contexts
        used: [],
        comprehension: "smooth",
      });
    }

    const vec = await db.getCompetencyVector();
    // morph_trials decays by 0.85^10 ≈ 0.197 per step — should be well below initial
    expect(vec.morph_trials).toBeLessThan(trialsBefore);
    expect(vec.morph_trials).toBeGreaterThanOrEqual(0);
    expect(vec.morph_obs).toBe(0);  // no obligatory contexts → obs not incremented
  });

  it("reception EWMA rises on smooth turns", async () => {
    const vecInitial = await db.getCompetencyVector();
    expect(vecInitial.reception_ewma).toBe(0.5);

    for (let i = 0; i < 5; i++) {
      await db.insertTurnAnnotation({ obligatory: [], used: [], comprehension: "smooth" });
    }

    const vec = await db.getCompetencyVector();
    expect(vec.reception_ewma).toBeGreaterThan(0.7);
    expect(vec.reception_obs).toBe(5);
  });

  it("reception EWMA drops on requested_simpler turns", async () => {
    // Start from a high reception baseline
    for (let i = 0; i < 5; i++) {
      await db.insertTurnAnnotation({ obligatory: [], used: [], comprehension: "smooth" });
    }
    const vecMid = await db.getCompetencyVector();
    const midLevel = vecMid.reception_ewma;

    for (let i = 0; i < 3; i++) {
      await db.insertTurnAnnotation({ obligatory: [], used: [], comprehension: "requested_simpler" });
    }

    const vec = await db.getCompetencyVector();
    expect(vec.reception_ewma).toBeLessThan(midLevel);
  });

  it("getRecentAnnotations returns most recent first", async () => {
    await db.insertTurnAnnotation({ obligatory: [], used: ["first"], comprehension: "smooth" });
    await db.insertTurnAnnotation({ obligatory: [], used: ["second"], comprehension: "smooth" });
    const anns = await db.getRecentAnnotations(2);
    expect(anns).toHaveLength(2);
    const usedFirst: string[] = JSON.parse(anns[0].used_json);
    expect(usedFirst[0]).toBe("second");  // most recent first
  });

  it("getCompetencyVector confidence gating via getCompetencyVector() wrapper", async () => {
    // With 0 observations, all confidence levels are low/medium
    const vec = await getCompetencyVector({ competency: db, vocab: db });
    expect(vec.morphology.confidence).toBe("low");
    expect(vec.idiomaticity.confidence).toBe("low");
    expect(vec.syntax.confidence).toBe("low");
  });

  it("stores difficulty-weighted proficiency evidence and exposes reception by level", async () => {
    await db.insertProficiencyEvidence({
      skill: "reception",
      dimension: "lexical",
      level: "B2",
      outcome: "success",
      confidence: 0.9,
      weight: 1.7,
      evidence_text: "Understood a B2 lexical challenge",
      challenge_json: JSON.stringify({ lexicalDifficulty: 0.7 }),
    });

    const rows = await db.listProficiencyEvidence(10);
    expect(rows[0].level).toBe("B2");

    const cv = await getCompetencyVector({ competency: db, vocab: db });
    expect(cv.reception.byLevel.B2.score).toBeCloseTo(1);
    expect(cv.reception.byLevel.B2.obs).toBe(1);
    expect(cv.reception.byLevel.C1.score).toBeNull();
  });

  it("updateCompetencyVector patches specific fields", async () => {
    await db.updateCompetencyVector({ morph_successes: 9.0, morph_trials: 10.0 });
    const vec = await db.getCompetencyVector();
    expect(vec.morph_successes).toBe(9.0);
    expect(vec.morph_trials).toBe(10.0);
    expect(vec.morph_obs).toBe(0);  // untouched
  });
});
