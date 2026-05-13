// FSRS-4.5: Free Spaced Repetition Scheduler, version 4.5
//
// The core idea of spaced repetition: show a flashcard right before you're
// about to forget it. Review it at that moment and the memory consolidates —
// next time you can wait even longer before it needs refreshing.
//
// FSRS models each card with two numbers:
//   - Stability (S): how many days until you have a 90% chance of still
//     remembering it. A card with S=30 will be shown again in ~30 days.
//   - Difficulty (D): how inherently hard this card is, on a 1–10 scale.
//     Easy cards (low D) grow faster; hard cards (high D) stay short.
//
// After each review the algorithm updates both numbers based on:
//   - How well you remembered (grade 1–4)
//   - How much time has passed since the last review (retrievability R)
//
// W[] are the 19 weights that define the algorithm's shape. These come from
// training on millions of real Anki reviews and are treated as constants here.

const W: readonly number[] = [
  // W[0..3]: initial stability S₀ for internal FSRS grades 1–4 on the very first review.
  // W[1] (Hard/2) is never used — we skip that grade.
  // Grade 4 (Easy) starts at S=15.47 → next review in ~15 days.
  // Grade 1 (Again) starts at S=0.41 → shown again tomorrow.
  0.4072, 1.1829, 3.1262, 15.4722,

  // W[4..7]: initial difficulty formula coefficients.
  // W[4] is the D₀ baseline; W[5] controls how much grade shifts it.
  // W[6] is the per-review delta rate; W[7] is mean-reversion strength.
  7.2102, 0.5316, 1.0651, 0.0589,

  // W[8..11]: stability growth formula when the card is recalled (grade ≥ 2).
  // W[8] is the base growth exponent; W[9] dampens growth for already-stable cards;
  // W[10] amplifies reward for reviewing near the forgetting point.
  // W[11..14] are used in the forget path (grade = 1).
  1.5330, 0.1544, 1.0040, 1.9813,

  // W[12..15]: forget path + hard penalty.
  // W[15] is the Hard penalty — unused since we skip grade=2.
  0.0953, 0.2975, 2.2042, 0.2407,

  // W[16]: easy bonus — multiplies stability when grade = 4.
  2.9466, 0.5034, 0.6567,
];

// DECAY and FACTOR come from solving "what interval gives 90% retention?".
// Retrievability R(t, S) = (1 + FACTOR * t/S)^DECAY
// At t = S: R ≈ 0.9. So the interval we schedule equals S in days.
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // ≈ 0.2343

// Conversational grades — what the bot observes in the dialogue.
export type Grade = 1 | 2 | 3;
// 1 = Again — wrong or error (silence doesn't count — maybe just no context)
// 2 = Good  — correct, independent production
// 3 = Easy  — spontaneous, fluent, unprompted use

// Internal FSRS grades (1/3/4 — Hard/2 is skipped intentionally).
// 1→1 (Again), 2→3 (Good), 3→4 (Easy).
type FsrsGrade = 1 | 2 | 3 | 4;
function toFsrsGrade(g: Grade): FsrsGrade {
  return ([1, 3, 4] as const)[g - 1];
}

export interface FsrsState {
  stability: number;   // days until ~10% forgetting chance
  difficulty: number;  // 1–10, higher = harder
  reps: number;        // successful review count (resets to 0 on Again)
}

export type VocabStatus = "new" | "learning" | "review" | "mastered";

export interface FsrsResult extends FsrsState {
  status: VocabStatus;
  due_days: number;  // schedule next review this many days from now
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

// R(t, S): probability of recall after t days given stability S.
// Returns a value in (0, 1]. At t=0 → R=1 (just learned). At t=S → R≈0.9.
// The further past the due date, the lower R falls.
function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

// Round stability to the nearest whole day (minimum 1) for the next interval.
function nextInterval(stability: number): number {
  return Math.max(1, Math.round(stability));
}

// Human-readable bucket based on how deeply the card is learned.
export function statusOf(reps: number, stability: number): VocabStatus {
  if (reps === 0) return "new";       // never successfully reviewed
  if (stability < 7) return "learning";  // interval < 1 week
  if (stability < 30) return "review";   // interval < 1 month
  return "mastered";                     // interval ≥ 1 month
}

// D₀(g): starting difficulty for a brand-new card (g is internal FSRS grade).
// Declines from ~7.2 (g=1, very hard start) to ~3.3 (g=4, easy start).
function initialDifficulty(g: FsrsGrade): number {
  return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
}

// D'(D, g): update difficulty after a review (g is internal FSRS grade).
// g=3 (Good) is the neutral point — difficulty barely moves.
// g=1 (Again) pushes D up (card is harder than we thought).
// g=4 (Easy) pulls D down toward the easy baseline D₀(g=4).
// Mean reversion with weight W[7] keeps D from drifting to extremes.
function nextDifficulty(d: number, g: FsrsGrade): number {
  const d0mean = W[4] - Math.exp(W[5] * 3) + 1; // D₀(g=4) ≈ 3.28, the easy anchor
  return clamp(W[7] * d0mean + (1 - W[7]) * (d - W[6] * (g - 3)), 1, 10);
}

// Call this on the very first review of a card (reps === 0).
// Sets S and D based solely on the grade — no prior history to work with.
export function fsrsInitial(grade: Grade): FsrsResult {
  const g = toFsrsGrade(grade);
  const stability = W[g - 1]; // S₀ lookup: W[0]=0.41 (Again) / W[2]=3.13 (Good) / W[3]=15.47 (Easy)
  const difficulty = initialDifficulty(g);
  // If the user couldn't recall it at all (Again), don't count it as a rep.
  const reps = grade === 1 ? 0 : 1;
  return {
    stability: Math.round(stability * 100) / 100,
    difficulty: Math.round(difficulty * 100) / 100,
    reps,
    status: statusOf(reps, stability),
    due_days: nextInterval(stability),
  };
}

// Call this on every review after the first (reps > 0).
// elapsedDays: how many days have passed since the last review.
export function fsrsReview(state: FsrsState, grade: Grade, elapsedDays: number): FsrsResult {
  const g = toFsrsGrade(grade);
  const { stability: S, difficulty: D, reps } = state;
  const elapsed = Math.max(0.1, elapsedDays); // guard against same-second double-reviews
  const R = retrievability(elapsed, S);

  let newS: number;
  if (grade === 1) {
    // Forgot: stability collapses. The formula gives a small positive S so
    // the card comes back soon (typically 1 day). D and R still matter —
    // a high-D card that was almost forgotten anyway gets a bit more time
    // than one that was cruising comfortably.
    newS = W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R));
  } else {
    // Recalled: stability grows. Key insight — the growth is largest when R is
    // low (you reviewed right at the forgetting edge) and smallest when R is
    // high (you reviewed way too early, so the memory didn't need consolidating).
    // This is why "optimal" review timing matters for long-term efficiency.
    const eb = g === 4 ? W[16] : 1; // Easy bonus: boosts growth for grade=3 (Easy→FSRS-4)
    newS = S * (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * eb + 1);
  }

  newS = Math.max(0.1, newS); // floor: never schedule more than 2.4 hours out
  const newD = nextDifficulty(D, g);
  const newReps = grade === 1 ? 0 : reps + 1; // Again resets the streak

  return {
    stability: Math.round(newS * 100) / 100,
    difficulty: Math.round(newD * 100) / 100,
    reps: newReps,
    status: statusOf(newReps, newS),
    due_days: nextInterval(newS),
  };
}
