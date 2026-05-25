import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import type { LLMProvider, ChatMessage, ChatResult, ChatOptions } from "../providers/interfaces.js";
import { PostTurnProcessor } from "./PostTurnProcessor.js";

class JsonProvider implements LLMProvider {
  public calls: Array<{ systemPrompt: string | null; userPrompt: string; opts?: ChatOptions }> = [];
  constructor(private payload: unknown) {}
  async chat(_messages: ChatMessage[], _tools?: object[], _opts?: ChatOptions): Promise<ChatResult> {
    throw new Error("chat should not be used by post-turn processor");
  }
  async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
    this.calls.push({ systemPrompt, userPrompt, opts });
    return JSON.stringify(this.payload);
  }
  async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
    this.calls.push({ systemPrompt, userPrompt, opts });
    return this.payload as T;
  }
}

let db: BuddyDb;
let dbPath: string;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-postturn-"));
  dbPath = path.join(tmpDir, "test.db");
  db = await BuddyDb.open(dbPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PostTurnProcessor", () => {
  it("always runs deterministic evaluator annotation after a normal assistant response", async () => {
    const provider = new JsonProvider({
      annotation: {
        obligatory: [{ type: "verb_conjugation" }],
        used: ["pretérito indefinido"],
        naturalness: 0.82,
        comprehension: "smooth",
        tunit_length: 2,
        had_subordination: true,
      },
      mode: "DIG",
      errors: [],
      vocabulary: [],
      reviews: [],
    });

    const processor = new PostTurnProcessor({ provider, vocab: db, errors: db, competency: db, session: db, lang: SpanishLanguage });
    const result = await processor.process({ userMessage: "Ayer yo comí paella", assistantText: "¡Qué rico!", chatHistory: [] });

    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].opts?.temperature).toBe(0);
    const anns = await db.getRecentAnnotations(5);
    expect(anns).toHaveLength(1);
    expect(JSON.parse(anns[0].obligatory_json)).toEqual([{ type: "verb_conjugation" }]);
    const { session } = await db.getConversationState();
    expect(session.last_mode).toBe("DIG");
  });

  it("captures corrections, vocabulary, and grammar questions into the learning inbox", async () => {
    const provider = new JsonProvider({
      annotation: { obligatory: [], used: [], naturalness: 1, comprehension: "smooth" },
      mode: "TEACH",
      errors: [{ user_text: "yo es", correct: "yo soy", category: "verb_conjugation", note: "ser conjugation" }],
      vocabulary: [{ word: "me cuesta + [inf]", context: "Me cuesta levantarme temprano", anchor: "costar", reason: "corrective chunk", priority: 0.8 }],
      learning_items: [{ type: "grammar_point", title: "fui vs voy", explanation: "past vs present", priority: 0.9, practice_modes: ["short_drill"] }],
      reviews: [],
    });

    const processor = new PostTurnProcessor({ provider, vocab: db, errors: db, competency: db, session: db, learning: db, lang: SpanishLanguage });
    const result = await processor.process({ userMessage: "Por qué fui y no voy?", assistantText: "Fui es pasado; voy es presente.", chatHistory: [] });

    expect(result.learningItemsAdded).toBe(3);
    const items = await db.listLearningItems("active", 10);
    expect(items.map((i) => [i.type, i.title])).toEqual([
      ["correction", "yo es → yo soy"],
      ["grammar_point", "fui vs voy"],
      ["phrase", "me cuesta + [inf]"],
    ]);
  });

  it("stages evaluator vocabulary as candidates instead of directly growing active SRS", async () => {
    const provider = new JsonProvider({
      annotation: { obligatory: [], used: [], naturalness: 1, comprehension: "smooth" },
      mode: "REACT",
      errors: [{ user_text: "yo es", correct: "yo soy", category: "verb_conjugation", note: "ser conjugation" }],
      vocabulary: [{ word: "me cuesta + [inf]", context: "Me cuesta levantarme temprano", anchor: "costar", reason: "corrective chunk", priority: 0.8 }],
      reviews: [],
    });

    const processor = new PostTurnProcessor({ provider, vocab: db, errors: db, competency: db, session: db, lang: SpanishLanguage });
    const result = await processor.process({ userMessage: "yo es cansado", assistantText: "Dirías: yo estoy cansado.", chatHistory: [] });

    const errors = await db.listErrors("verb_conjugation", 10);
    expect(errors).toHaveLength(1);
    expect(errors[0].correct_form).toBe("yo soy");
    expect(result.vocabAdded).toBe(0);
    expect(result.vocabCandidatesAdded).toBe(1);
    expect(await db.listVocab("all", 10)).toHaveLength(0);
    const candidates = await db.listVocabCandidates("candidate", 10);
    expect(candidates.map((v) => v.chunk_l2)).toContain("me cuesta + [inf]");
  });

  it("finishes scheduled review attempts from evaluator output and advances the right FSRS lane", async () => {
    await db.addVocab("echar de menos", "Te echo de menos", "echar");
    const attempt = await db.startVocabReviewAttempt({
      word: "echar de menos",
      mode: "productive",
      strategy: "personal_question",
      prompt_text: "¿A quién echas de menos?",
    });
    const provider = new JsonProvider({
      annotation: { obligatory: [], used: ["echar de menos"], naturalness: 1, comprehension: "smooth" },
      mode: "REACT",
      errors: [],
      vocabulary: [],
      reviews: [{ attempt_id: attempt.id, user_response: "Echo de menos a mi hermana", target_used: true, accepted_variant: "echo de menos", hint_level: 0, grade: 3, note: "fluent" }],
    });

    const processor = new PostTurnProcessor({ provider, vocab: db, errors: db, competency: db, session: db, lang: SpanishLanguage });
    await processor.process({ userMessage: "Echo de menos a mi hermana", assistantText: "Qué bonito.", chatHistory: [] });

    const row = db.db.exec("SELECT pro_reps, rec_reps FROM vocabulary_items WHERE chunk_l2 = 'echar de menos'")[0].values[0];
    expect(row).toEqual([1, 0]);
  });

  it("records an audit row when evaluator scores a review by word without an attempt id", async () => {
    await db.addVocab("pasar el fin de semana", "ctx", "pasar");
    const provider = new JsonProvider({
      annotation: { obligatory: [], used: ["pasar el fin de semana"], naturalness: 1, comprehension: "smooth" },
      mode: "REACT",
      errors: [],
      vocabulary: [],
      reviews: [{ word: "pasar el fin de semana", mode: "productive", user_response: "Voy a pasar el fin de semana tranquilo", target_used: true, accepted_variant: "pasar el fin de semana", hint_level: 0, grade: 3, note: "spontaneous" }],
    });

    const processor = new PostTurnProcessor({ provider, vocab: db, errors: db, competency: db, session: db, lang: SpanishLanguage });
    await processor.process({ userMessage: "Voy a pasar el fin de semana tranquilo", assistantText: "Perfecto.", chatHistory: [] });

    const attempts = db.db.exec("SELECT word, mode, status, user_response, target_used, accepted_variant, grade, note FROM vocab_review_attempts")[0].values;
    expect(attempts).toEqual([["pasar el fin de semana", "productive", "completed", "Voy a pasar el fin de semana tranquilo", 1, "pasar el fin de semana", 3, "spontaneous"]]);
    const row = db.db.exec("SELECT pro_reps, rec_reps FROM vocabulary_items WHERE chunk_l2 = 'pasar el fin de semana'")[0].values[0];
    expect(row).toEqual([1, 0]);
  });

  it("shows active attempts to the evaluator so the next learner reply can close them", async () => {
    await db.addVocab("coger el tren", "ctx", "coger");
    const attempt = await db.startVocabReviewAttempt({
      word: "coger el tren",
      mode: "productive",
      strategy: "cloze",
      prompt_text: "Completa: Mañana tengo que ___ para ir al trabajo.",
      hint_level: 1,
    });
    const provider = new JsonProvider({
      annotation: { obligatory: [], used: ["coger el tren"], naturalness: 1, comprehension: "smooth" },
      mode: "REACT",
      errors: [],
      vocabulary: [],
      reviews: [{ attempt_id: attempt.id, word: "coger el tren", mode: "productive", user_response: "Tengo que coger el tren", target_used: true, accepted_variant: "coger el tren", hint_level: 1, grade: 2, note: "answered cloze" }],
    });

    const processor = new PostTurnProcessor({ provider, vocab: db, errors: db, competency: db, session: db, lang: SpanishLanguage });
    await processor.process({ userMessage: "Tengo que coger el tren", assistantText: "Exacto.", chatHistory: [] });

    expect(provider.calls[0].userPrompt).toContain("Active review attempts:");
    expect(provider.calls[0].userPrompt).toContain(`\"attempt_id\":${attempt.id}`);
    expect(provider.calls[0].userPrompt).toContain("coger el tren");
    const active = await db.listActiveVocabReviewAttempts();
    expect(active).toHaveLength(0);
  });

  it("matches an active attempt by word and mode when the evaluator omits attempt_id", async () => {
    await db.addVocab("coger el tren", "ctx", "coger");
    await db.startVocabReviewAttempt({
      word: "coger el tren",
      mode: "productive",
      strategy: "personal_question",
      prompt_text: "¿Cuándo coges el tren?",
    });
    const provider = new JsonProvider({
      annotation: { obligatory: [], used: ["coger el tren"], naturalness: 1, comprehension: "smooth" },
      mode: "REACT",
      errors: [],
      vocabulary: [],
      reviews: [{ word: "coger el tren", mode: "productive", user_response: "Cojo el tren mañana", target_used: true, accepted_variant: "cojo el tren", hint_level: 0, grade: 3, note: "correct" }],
    });

    const processor = new PostTurnProcessor({ provider, vocab: db, errors: db, competency: db, session: db, lang: SpanishLanguage });
    const result = await processor.process({ userMessage: "Cojo el tren mañana", assistantText: "Muy bien.", chatHistory: [] });

    expect(result.reviewsCompleted).toBe(1);
    expect(await db.listActiveVocabReviewAttempts()).toHaveLength(0);
    const attempts = db.db.exec("SELECT word, status, grade FROM vocab_review_attempts")[0].values;
    expect(attempts).toEqual([["coger el tren", "completed", 3]]);
    const row = db.db.exec("SELECT pro_reps, rec_reps FROM vocabulary_items WHERE chunk_l2 = 'coger el tren'")[0].values[0];
    expect(row).toEqual([1, 0]);
  });
});
