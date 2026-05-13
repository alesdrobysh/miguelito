import fs from "fs";
import { BuddyDb } from "./db.js";
import { getCompetencyVector, selectFocusAxis, renderCalibration } from "./competency.js";

interface ProfileInjection {
  basicProfile: string;
  learnerProfile: string | null;
  calibration: string | null;
  userInterests: string | null;
  dreamMemory: string | null;
}

export async function buildProfileInjection(db: BuddyDb, dreamMemoryPath?: string): Promise<ProfileInjection> {
  const profile = await db.getProfile();

  const basicProfile = profile
    ? `\n\n## Learner Profile\nName: ${profile.name ?? "unknown"} | Goal: ${profile.goal ?? "none"} | Correction style: ${profile.correction_style ?? "inline"}`
    : `\n\n## Learner Profile\nNot configured yet — begin onboarding when user sends /start.`;

  let calibration: string | null = null;
  try {
    const vec = await getCompetencyVector(db);
    const focus = selectFocusAxis(vec);
    calibration = `\n\n${renderCalibration(vec, focus)}`;
  } catch {}

  const words = await getDueWords(db, 5);
  const weakAreas = await getWeakAreas(db, 3);
  const errorInfo = weakAreas.length > 0 ? await getRecentErrorForCategory(db, weakAreas[0]) : null;

  const hasLearnerData = words.length > 0 || errorInfo != null || weakAreas.length > 0;

  const learnerProfile = hasLearnerData
    ? formatProfile(words, errorInfo, weakAreas)
    : null;

  const interests = await db.listInterests(10);
  const userInterests = interests.length > 0
    ? `\n\n## User Interests\n${interests.join(", ")}`
    : null;

  let dreamMemory: string | null = null;
  if (dreamMemoryPath && fs.existsSync(dreamMemoryPath)) {
    const content = fs.readFileSync(dreamMemoryPath, "utf8").trim();
    if (content) dreamMemory = `\n\n## Dream Memory\n${content}`;
  }

  return { basicProfile, learnerProfile, calibration, userInterests, dreamMemory };
}

function formatProfile(
  words: string[],
  errorInfo: { user_text: string; correct: string; category: string } | null,
  weakAreas: string[],
): string {
  const lines: string[] = ["\n\n## Current Learner Profile"];

  if (weakAreas.length > 0) {
    lines.push(`**Weak Areas**: ${weakAreas.join(", ")}`);
  }

  if (words.length > 0) {
    lines.push(`**Words to Weave In**: ${words.join(", ")}`);
  }

  if (errorInfo) {
    lines.push(`**Error to Reinforce**: "${errorInfo.user_text}" → "${errorInfo.correct}" (${errorInfo.category})`);
  }

  return lines.join("\n");
}

async function getDueWords(db: BuddyDb, limit: number): Promise<string[]> {
  try {
    const rows = await db.dueVocab(limit);
    return rows.map((r) => r.chunk_l2);
  } catch {
    return [];
  }
}

async function getWeakAreas(db: BuddyDb, limit: number): Promise<string[]> {
  try {
    const allErrors = await db.listErrors("all", 1000);
    const counts = new Map<string, number>();
    for (const e of allErrors) {
      counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([cat]) => cat);
  } catch {
    return [];
  }
}

async function getRecentErrorForCategory(
  db: BuddyDb,
  category: string,
): Promise<{ user_text: string; correct: string; category: string } | null> {
  try {
    const errors = await db.listErrors(category, 1);
    if (errors.length === 0) return null;
    const e = errors[0];
    return { user_text: e.user_text, correct: e.correct_form, category: e.category };
  } catch {
    return null;
  }
}
