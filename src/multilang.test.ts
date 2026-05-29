import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BuddyDb } from "./infrastructure/db.js";
import { SpanishLanguage } from "./languages/spanish/index.js";
import { createMultilangTestDb, type MultilangTestDbHandle } from "./test/dbHelpers.js";

let dbSpanish: BuddyDb;
let dbSecondary: BuddyDb;
let dbPath: string;
let handle: MultilangTestDbHandle;

beforeEach(async () => {
  handle = await createMultilangTestDb();
  dbSpanish = handle.dbSpanish;
  dbSecondary = handle.dbSecondary;
  dbPath = handle.dbPath;
});

afterEach(() => {
  handle.cleanup();
});

describe("Multi-language scoping in same database", () => {
  it("vocabulary is scoped by language", async () => {
    await dbSpanish.addVocab("gato", "el gato");
    await dbSecondary.addVocab("chunk", "secondary context");

    const spanVocab = await dbSpanish.listVocab("all", 10);
    expect(spanVocab).toHaveLength(1);
    expect(spanVocab[0].chunk_l2).toBe("gato");

    const secondaryVocab = await dbSecondary.listVocab("all", 10);
    expect(secondaryVocab).toHaveLength(1);
    expect(secondaryVocab[0].chunk_l2).toBe("chunk");
  });

  it("errors are scoped by language", async () => {
    await dbSpanish.logError("la gata", "el gato", "gender", "");
    await dbSecondary.logError("secondary wrong", "secondary right", "generic", "");

    const spanErrors = await dbSpanish.listErrors("all", 10);
    expect(spanErrors).toHaveLength(1);
    expect(spanErrors[0].user_text).toBe("la gata");

    const secondaryErrors = await dbSecondary.listErrors("all", 10);
    expect(secondaryErrors).toHaveLength(1);
    expect(secondaryErrors[0].user_text).toBe("secondary wrong");
  });

  it("conversation state and history are scoped by language", async () => {
    const spanSession = await dbSpanish.getConversationState();
    const secondarySession = await dbSecondary.getConversationState();

    expect(spanSession.session.session_id).not.toBe(secondarySession.session.session_id);

    await dbSpanish.addChatMessage(123, "user", "Hola", spanSession.session.session_id);
    await dbSecondary.addChatMessage(123, "user", "Secondary hello", secondarySession.session.session_id);

    const spanHistory = await dbSpanish.getChatHistory(123, 10);
    expect(spanHistory).toHaveLength(1);
    expect(spanHistory[0].content).toBe("Hola");

    const secondaryHistory = await dbSecondary.getChatHistory(123, 10);
    expect(secondaryHistory).toHaveLength(1);
    expect(secondaryHistory[0].content).toBe("Secondary hello");
  });

  it("competency vector is scoped by language", async () => {
    await dbSpanish.updateCompetencyVector({ morph_successes: 10 });
    await dbSecondary.updateCompetencyVector({ morph_successes: 20 });

    const spanVec = await dbSpanish.getCompetencyVector();
    expect(spanVec.morph_successes).toBe(10);

    const secondaryVec = await dbSecondary.getCompetencyVector();
    expect(secondaryVec.morph_successes).toBe(20);
  });

  it("user profile and interests are GLOBAL", async () => {
    // Open spanish, set profile, close
    const db1 = await BuddyDb.open(dbPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
    await db1.setProfile({ name: "Miguel" });
    await db1.addInterest("Music", "conv", 0.8);
    db1.close();

    // Open a secondary language scope, check global profile, close
    const db2 = await BuddyDb.open(dbPath, "secondary", [], []);
    const secondaryProfile = await db2.getProfile();
    expect(secondaryProfile?.name).toBe("Miguel");

    const secondaryInterests = await db2.listInterests(10);
    expect(secondaryInterests).toContain("Music");
    db2.close();
  });
});
