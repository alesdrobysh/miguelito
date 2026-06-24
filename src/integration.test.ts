import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { BuddyDb } from "./infrastructure/db.js";
import { SpanishLanguage } from "./languages/spanish/index.js";
import { createTools, toolsToOpenAI } from "./tools/index.js";
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


describe("integration: error log + summary cycle", () => {
  it("logs errors and verifies categories in progress summary", async () => {
    const tools = createTools({ errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider: null }, SpanishLanguage);
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
    const tools = createTools({ errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider: null }, SpanishLanguage);
    const setTool = tools.get("miguelito_profile_set")!;

    const setResult = await setTool.execute({ name: "Alice", goal: "travel", correction_style: "suave" });
    expect((setResult as any).ok).toBe(true);
    expect((setResult as any).updated_fields).toContain("name");
    expect((setResult as any).updated_fields).toContain("goal");
    expect((setResult as any).updated_fields).toContain("correction_style");

    const profile = await db.getProfile();
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("Alice");
    expect(profile!.goal).toBe("travel");
    expect(profile!.correction_style).toBe("suave");
  });

  it("partial updates preserve existing fields", async () => {
    const tools = createTools({ errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider: null }, SpanishLanguage);
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
    const tools = createTools({ errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider: null }, SpanishLanguage);
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
  it("returns correct counts after logging errors without relying on legacy vocab tools", async () => {
    const tools = createTools({ errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider: null }, SpanishLanguage);
    const errorTool = tools.get("miguelito_error_log")!;
    const progressTool = tools.get("miguelito_progress_summary")!;

    await errorTool.execute({ user_text: "la gata", correct: "el gato", category: "gender" });
    await errorTool.execute({ user_text: "yo es", correct: "yo soy", category: "verb_conjugation" });
    await errorTool.execute({ user_text: "la mesa", correct: "el mesa", category: "gender" });

    const summary = await progressTool.execute({});
    expect((summary as any).ok).toBe(true);
    expect((summary as any).learning_items.active).toBe(0);
    expect((summary as any).learning_items.new).toBe(0);
    expect((summary as any).learning_items.practiced).toBe(0);
    expect((summary as any).learning_items.due_now).toBe(0);
    expect((summary as any).hygiene.backlog_status).toBe("healthy");
    expect((summary as any).hygiene.active_without_evidence).toBe(0);
    expect((summary as any).error_categories["gender"]).toBe(2);
    expect((summary as any).error_categories["verb_conjugation"]).toBe(1);
  });
});


describe("integration: tool registry creates all expected tools", () => {
  it("createTools returns all tool names", () => {
    const tools = createTools({ errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider: null }, SpanishLanguage);

    const expectedNames = [
      "miguelito_error_log",
      "miguelito_profile_set",
      "miguelito_read_link",
      "miguelito_interest_add",
      "miguelito_progress_summary",
      "miguelito_turn_annotate",
    ];

    expect(tools.size).toBe(6);
    for (const name of expectedNames) {
      expect(tools.has(name)).toBe(true);
    }
  });
});

describe("integration: toolsToOpenAI produces valid format", () => {
  it("output has type/function/name structure for each tool", () => {
    const tools = createTools({ errors: db, profile: db, langProfile: db, interests: db, competency: db, session: db, learning: db, provider: null }, SpanishLanguage);
    const openai = toolsToOpenAI(tools);

    expect(Array.isArray(openai)).toBe(true);
    expect(openai).toHaveLength(6);

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
