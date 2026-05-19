import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "./infrastructure/db.js";
import { SpanishLanguage } from "./languages/spanish/index.js";
import { createTools, toolsToOpenAI } from "./tools/index.js";

let db: BuddyDb;
let dbPath: string;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-test-"));
  dbPath = path.join(tmpDir, "test.db");
  db = await BuddyDb.open(
    dbPath,
    "spanish",
    SpanishLanguage.errorCategories,
    SpanishLanguage.morphologyCategories,
  );
});

afterEach(async () => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("integration: vocab add + score + due cycle", () => {
  it("adds a word, scores it, and verifies it is no longer due", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const addTool = tools.get("miguelito_vocab_add")!;
    const scoreTool = tools.get("miguelito_vocab_score")!;
    const progressTool = tools.get("miguelito_progress_summary")!;

    const addResult = await addTool.execute({ word: "gato", context: "El gato duerme" });
    expect(addResult).toEqual({ added: true, id: expect.any(Number), word: "gato", anchor: null });

    const dueBefore = await progressTool.execute({});
    expect((dueBefore as any).vocab.due_now).toBe(1);

    const scoreResult = await scoreTool.execute({ word: "gato", quality: "4" });
    expect((scoreResult as any).ok).toBe(true);
    expect((scoreResult as any).status).toBe("learning");
    expect((scoreResult as any).reps).toBe(1);

    const dueAfter = await progressTool.execute({});
    expect((dueAfter as any).vocab.due_now).toBe(0);
  });
});

describe("integration: vocab list with buckets", () => {
  it("filters by bucket after scoring some words", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const addTool = tools.get("miguelito_vocab_add")!;
    const scoreTool = tools.get("miguelito_vocab_score")!;
    const listTool = tools.get("miguelito_vocab_list")!;

    await addTool.execute({ word: "gato", translation: "cat" });
    await addTool.execute({ word: "perro", translation: "dog" });
    await addTool.execute({ word: "casa", translation: "house" });

    const allBefore = await listTool.execute({ bucket: "all" });
    expect((allBefore as any).count).toBe(3);

    const newBefore = await listTool.execute({ bucket: "new" });
    expect((newBefore as any).count).toBe(3);

    await scoreTool.execute({ word: "gato", quality: "4" });
    await scoreTool.execute({ word: "perro", quality: "4" });

    const newAfter = await listTool.execute({ bucket: "new" });
    expect((newAfter as any).count).toBe(1);
    expect((newAfter as any).items[0].word).toBe("casa");

    const learningAfter = await listTool.execute({ bucket: "learning" });
    expect((learningAfter as any).count).toBe(2);
  });
});

describe("integration: error log + summary cycle", () => {
  it("logs errors and verifies categories in progress summary", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const logTool = tools.get("miguelito_error_log")!;
    const progressTool = tools.get("miguelito_progress_summary")!;

    await logTool.execute({ user_text: "la gata", correct: "el gato", category: "gender", note: "wrong gender" });
    await logTool.execute({ user_text: "yo es", correct: "yo soy", category: "verb_conjugation", note: "" });
    await logTool.execute({ user_text: "a escuela", correct: "a la escuela", category: "preposition", note: "" });

    const summary = await progressTool.execute({});
    expect((summary as any).error_categories["gender"]).toBe(1);
    expect((summary as any).error_categories["verb_conjugation"]).toBe(1);
    expect((summary as any).error_categories["preposition"]).toBe(1);
  });
});

describe("integration: profile set cycle", () => {
  it("sets profile fields and confirms via db", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const setTool = tools.get("miguelito_profile_set")!;

    const setResult = await setTool.execute({ name: "Alice", goal: "travel" });
    expect((setResult as any).ok).toBe(true);
    expect((setResult as any).updated_fields).toContain("name");
    expect((setResult as any).updated_fields).toContain("goal");

    const profile = await db.getProfile();
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("Alice");
    expect(profile!.goal).toBe("travel");
  });

  it("partial updates preserve existing fields", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const setTool = tools.get("miguelito_profile_set")!;

    await setTool.execute({ name: "Bob", goal: "travel" });
    await setTool.execute({ goal: "conversation" });

    const profile = await db.getProfile();
    expect(profile!.name).toBe("Bob");
    expect(profile!.goal).toBe("conversation");
  });
});

describe("integration: interest add + list", () => {
  it("adds interests and deduplicates", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const addTool = tools.get("miguelito_interest_add")!;

    const result1 = await addTool.execute({ interest: "cooking", source: "conversation", confidence: "0.8" });
    expect((result1 as any).added).toBe(true);
    expect((result1 as any).total_interests).toBe(1);

    const result2 = await addTool.execute({ interest: "music", source: "explicit", confidence: "0.9" });
    expect((result2 as any).added).toBe(true);
    expect((result2 as any).total_interests).toBe(2);

    const result3 = await addTool.execute({ interest: "Cooking", source: "explicit", confidence: "0.95" });
    expect((result3 as any).added).toBe(false);
    expect((result3 as any).reason).toBe("invalid_or_duplicate");

    const interests = await db.listInterests(10);
    expect(interests).toHaveLength(2);
  });
});

describe("integration: progress summary aggregates", () => {
  it("returns correct counts after adding vocab and errors", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const addTool = tools.get("miguelito_vocab_add")!;
    const scoreTool = tools.get("miguelito_vocab_score")!;
    const errorTool = tools.get("miguelito_error_log")!;
    const progressTool = tools.get("miguelito_progress_summary")!;

    await addTool.execute({ word: "gato", translation: "cat" });
    await addTool.execute({ word: "perro", translation: "dog" });
    await addTool.execute({ word: "casa", translation: "house" });
    await scoreTool.execute({ word: "gato", quality: "4" });

    await errorTool.execute({ user_text: "la gata", correct: "el gato", category: "gender" });
    await errorTool.execute({ user_text: "yo es", correct: "yo soy", category: "verb_conjugation" });
    await errorTool.execute({ user_text: "la mesa", correct: "el mesa", category: "gender" });

    const summary = await progressTool.execute({});
    expect((summary as any).ok).toBe(true);
    expect((summary as any).vocab.total).toBe(3);
    expect((summary as any).vocab.new).toBe(2);
    expect((summary as any).vocab.learning).toBe(1);
    expect((summary as any).vocab.due_now).toBe(2);
    expect((summary as any).error_categories["gender"]).toBe(2);
    expect((summary as any).error_categories["verb_conjugation"]).toBe(1);
  });
});

describe("integration: vocab export produces valid CSV", () => {
  it("exports words as CSV with correct content", async () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const addTool = tools.get("miguelito_vocab_add")!;
    const exportTool = tools.get("miguelito_vocab_export")!;

    await addTool.execute({ word: "gato", context: "El gato duerme" });
    await addTool.execute({ word: "perro", context: "El perro corre" });

    const result = await exportTool.execute({ format: "csv" });
    expect((result as any).ok).toBe(true);
    expect((result as any).count).toBe(2);
    expect((result as any).data).toContain("chunk_l2,anchor");
    expect((result as any).data).toContain("gato");
    expect((result as any).data).toContain("perro");
  });
});

describe("integration: tool registry creates all expected tools", () => {
  it("createTools returns all tool names", () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);

    const expectedNames = [
      "miguelito_vocab_add",
      "miguelito_vocab_list",
      "miguelito_vocab_score",
      "miguelito_vocab_export",
      "miguelito_error_log",
      "miguelito_profile_set",
      "miguelito_read_link",
      "miguelito_reading_suggest",
      "miguelito_interest_add",
      "miguelito_progress_summary",
      "miguelito_turn_annotate",
    ];

    expect(tools.size).toBe(11);
    for (const name of expectedNames) {
      expect(tools.has(name)).toBe(true);
    }
  });
});

describe("integration: toolsToOpenAI produces valid format", () => {
  it("output has type/function/name structure for each tool", () => {
    const tools = createTools({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null }, SpanishLanguage);
    const openai = toolsToOpenAI(tools);

    expect(Array.isArray(openai)).toBe(true);
    expect(openai).toHaveLength(11);

    for (const item of openai as any[]) {
      expect(item.type).toBe("function");
      expect(item.function).toBeDefined();
      expect(item.function.name).toBeTypeOf("string");
      expect(item.function.description).toBeTypeOf("string");
      expect(item.function.parameters).toBeDefined();
      expect(item.function.parameters.type).toBe("object");
    }
  });
});
