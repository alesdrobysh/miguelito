import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BuddyDb } from "./infrastructure/db.js";
import { SpanishLanguage } from "./languages/spanish/index.js";
import { PolishLanguage } from "./languages/polish/index.js";
import { createMultilangTestDb, type MultilangTestDbHandle } from "./test/dbHelpers.js";

let dbSpanish: BuddyDb;
let dbPolish: BuddyDb;
let dbPath: string;
let handle: MultilangTestDbHandle;

beforeEach(async () => {
  handle = await createMultilangTestDb();
  dbSpanish = handle.dbSpanish;
  dbPolish = handle.dbPolish;
  dbPath = handle.dbPath;
});

afterEach(() => {
  handle.cleanup();
});

describe("Multi-language scoping in same database", () => {
  it("vocabulary is scoped by language", async () => {
    await dbSpanish.addVocab("gato", "el gato");
    await dbPolish.addVocab("kot", "ten kot");

    const spanVocab = await dbSpanish.listVocab("all", 10);
    expect(spanVocab).toHaveLength(1);
    expect(spanVocab[0].chunk_l2).toBe("gato");

    const polVocab = await dbPolish.listVocab("all", 10);
    expect(polVocab).toHaveLength(1);
    expect(polVocab[0].chunk_l2).toBe("kot");
  });

  it("errors are scoped by language", async () => {
    await dbSpanish.logError("la gata", "el gato", "gender", "");
    await dbPolish.logError("ten gata", "ta gata", "gender", "");

    const spanErrors = await dbSpanish.listErrors("all", 10);
    expect(spanErrors).toHaveLength(1);
    expect(spanErrors[0].user_text).toBe("la gata");

    const polErrors = await dbPolish.listErrors("all", 10);
    expect(polErrors).toHaveLength(1);
    expect(polErrors[0].user_text).toBe("ten gata");
  });

  it("conversation state and history are scoped by language", async () => {
    const spanSession = await dbSpanish.getConversationState();
    const polSession = await dbPolish.getConversationState();

    expect(spanSession.session.session_id).not.toBe(polSession.session.session_id);

    await dbSpanish.addChatMessage(123, "user", "Hola", spanSession.session.session_id);
    await dbPolish.addChatMessage(123, "user", "Cześć", polSession.session.session_id);

    const spanHistory = await dbSpanish.getChatHistory(123, 10);
    expect(spanHistory).toHaveLength(1);
    expect(spanHistory[0].content).toBe("Hola");

    const polHistory = await dbPolish.getChatHistory(123, 10);
    expect(polHistory).toHaveLength(1);
    expect(polHistory[0].content).toBe("Cześć");
  });

  it("competency vector is scoped by language", async () => {
    await dbSpanish.updateCompetencyVector({ morph_successes: 10 });
    await dbPolish.updateCompetencyVector({ morph_successes: 20 });

    const spanVec = await dbSpanish.getCompetencyVector();
    expect(spanVec.morph_successes).toBe(10);

    const polVec = await dbPolish.getCompetencyVector();
    expect(polVec.morph_successes).toBe(20);
  });

  it("user profile and interests are GLOBAL", async () => {
    // Open spanish, set profile, close
    const db1 = await BuddyDb.open(dbPath, "spanish", SpanishLanguage.errorCategories, SpanishLanguage.morphologyCategories);
    await db1.setProfile({ name: "Miguel" });
    await db1.addInterest("Music", "conv", 0.8);
    db1.close();

    // Open polish, check profile, close
    const db2 = await BuddyDb.open(dbPath, "polish", PolishLanguage.errorCategories, PolishLanguage.morphologyCategories);
    const polProfile = await db2.getProfile();
    expect(polProfile?.name).toBe("Miguel");

    const polInterests = await db2.listInterests(10);
    expect(polInterests).toContain("Music");
    db2.close();
  });
});
