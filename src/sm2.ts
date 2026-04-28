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
  const q = Math.max(0, Math.min(5, quality));
  const newInterval =
    q >= 3
      ? repetitions === 0
        ? 1
        : repetitions === 1
          ? 6
          : Math.round(intervalDays * easeFactor)
      : 1;
  const newReps = q >= 3 ? repetitions + 1 : 0;
  const newEf = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );
  const status = statusOf(newReps, newInterval);
  return {
    repetitions: newReps,
    interval_days: newInterval,
    ease_factor: Math.round(newEf * 100) / 100,
    status,
  };
}