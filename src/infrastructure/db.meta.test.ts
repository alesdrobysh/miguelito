import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "./db.js";

let tmpDir: string;
let db: BuddyDb;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-test-"));
  db = await BuddyDb.open(path.join(tmpDir, "buddy.db"), "shared", [], []);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MetaRepository", () => {
  it("returns null for an unknown key", async () => {
    expect(await db.getMetaValue("nonexistent")).toBeNull();
  });

  it("stores and retrieves a value", async () => {
    await db.setMetaValue("test_key", "hello");
    expect(await db.getMetaValue("test_key")).toBe("hello");
  });

  it("overwrites existing value", async () => {
    await db.setMetaValue("test_key", "first");
    await db.setMetaValue("test_key", "second");
    expect(await db.getMetaValue("test_key")).toBe("second");
  });
});
