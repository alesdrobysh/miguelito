// SM-2 is a spaced repetition algorithm used in flashcard apps.
// Each card has three values: repetition count, interval (days), and ease factor (multiplier).
// A review quality score (0-5) determines how the card advances:
//   5 = perfect recall, 4 = correct after hesitation, 3 = correct with difficulty,
//   2 = incorrect but easy to recall, 1 = incorrect but familiar, 0 = complete blackout.
// Scores >= 3 count as a pass; scores < 3 fail the card.

// On pass: interval grows by multiplying by ease factor.
// On fail: interval resets to 1, repetitions reset to 0.
// Ease factor adjusts up/down based on quality to make intervals longer or shorter over time.

function calculateInterval(
  q: number,
  repetitions: number,
  intervalDays: number,
  easeFactor: number
): number {
  // Fail: reset to 1 day
  if (q < 3) return 1;
  // First ever pass: 1 day
  if (repetitions === 0) return 1;
  // Second pass in a row: 6 days
  if (repetitions === 1) return 6;
  // Subsequent passes: multiply previous interval by ease factor
  return Math.round(intervalDays * easeFactor);
}

// SM-2 ease factor formula: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
// (5-q) measures how far from perfect. Perfect (5) gives +0.1 boost.
// Low scores shrink the factor, making intervals grow more slowly.
// Floor of 1.3 prevents intervals from shrinking too aggressively.
function calculateEaseFactor(easeFactor: number, quality: number): number {
  return Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );
}

export function statusOf(repetitions: number, intervalDays: number): string {
  if (repetitions === 0) return "new";
  if (repetitions >= 6 && intervalDays >= 30) return "mastered";
  if (repetitions >= 3) return "review";
  return "learning";
}

export interface Sm2CalcResult {
  repetitions: number;
  interval_days: number;
  ease_factor: number;
  status: string;
}

export function sm2Review(
  easeFactor: number,
  repetitions: number,
  intervalDays: number,
  quality: number
): Sm2CalcResult {
  // clamp quality to valid range
  const q = Math.max(0, Math.min(5, quality));
  const newInterval = calculateInterval(q, repetitions, intervalDays, easeFactor);
  const newReps = q >= 3 ? repetitions + 1 : 0;
  const newEf = calculateEaseFactor(easeFactor, q);
  const status = statusOf(newReps, newInterval);
  return {
    repetitions: newReps,
    interval_days: newInterval,
    ease_factor: Math.round(newEf * 100) / 100,
    status,
  };
}