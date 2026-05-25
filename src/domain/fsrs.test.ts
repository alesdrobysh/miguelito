import { describe, it, expect } from "vitest";
import { fsrsInitial, fsrsReview, statusOf } from "./fsrs.js";

describe("fsrs", () => {
  it("statusOf returns correct thresholds", () => {
    expect(statusOf(0, 1)).toBe("new");
    expect(statusOf(1, 3)).toBe("learning");   // S < 7
    expect(statusOf(1, 7)).toBe("review");     // 7 ≤ S < 30
    expect(statusOf(1, 30)).toBe("mastered");  // S ≥ 30
  });

  it("fsrsInitial grade=2 (Good) gives learning status", () => {
    const r = fsrsInitial(2); // → FSRS grade 3, S₀ ≈ 3.13
    expect(r.reps).toBe(1);
    expect(r.status).toBe("learning");
    expect(r.due_days).toBeGreaterThanOrEqual(1);
  });

  it("fsrsInitial grade=3 (Easy) gives review status", () => {
    const r = fsrsInitial(3); // S₀ ≈ 15.47
    expect(r.reps).toBe(1);
    expect(r.status).toBe("review");
  });

  it("fsrsInitial grade=1 (Again) gives new status and reps=0", () => {
    const r = fsrsInitial(1);
    expect(r.reps).toBe(0);
    expect(r.status).toBe("new");
  });

  it("fsrsReview with elapsed time grows stability on grade=3 (Easy)", () => {
    const state = { stability: 10, difficulty: 5, reps: 1 };
    const r = fsrsReview(state, 3, 10);
    expect(r.stability).toBeGreaterThan(10);
    expect(r.reps).toBe(2);
  });

  it("fsrsReview grade=1 (Again) resets reps to 0", () => {
    const state = { stability: 10, difficulty: 5, reps: 3 };
    const r = fsrsReview(state, 1, 5);
    expect(r.reps).toBe(0);
    expect(r.status).toBe("new");
  });

  it("fsrsReview grade=3 (Easy) produces larger stability than grade=2 (Good)", () => {
    const state = { stability: 5, difficulty: 5, reps: 1 };
    const good = fsrsReview(state, 2, 3);
    const easy = fsrsReview(state, 3, 3);
    expect(easy.stability).toBeGreaterThan(good.stability);
  });
});
