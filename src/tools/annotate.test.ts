import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { createAnnotateTools } from "./annotate.js";
import type { ToolContext } from "./index.js";

let db: BuddyDb;
let tmpDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-ann-test-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"));
  ctx = { vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null };
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("miguelito_turn_annotate mode tracking", () => {
  it("records mode in conversation state when provided", async () => {
    const [annotate] = createAnnotateTools(ctx);

    await annotate.execute({
      obligatory: "[]",
      used: "[]",
      naturalness: "1.0",
      comprehension: "smooth",
      mode: "REACT",
    });

    const { session } = await db.getConversationState();
    const lastTwo: string[] = JSON.parse(session.last_two_modes);
    expect(lastTwo).toContain("REACT");
  });

  it("does not error when mode is omitted", async () => {
    const [annotate] = createAnnotateTools(ctx);

    await expect(
      annotate.execute({
        obligatory: "[]",
        used: "[]",
        naturalness: "1.0",
        comprehension: "smooth",
      })
    ).resolves.toBeDefined();
  });
});
