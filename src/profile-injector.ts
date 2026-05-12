import { BuddyDb } from "./db.js";

interface ProfileInjection {
  basicProfile: string;
  learnerProfile: string | null;
  userInterests: string | null;
  nativeLanguage: string;
}

export async function buildProfileInjection(db: BuddyDb): Promise<ProfileInjection> {
  const [profile, assessment] = await Promise.all([db.getProfile(), db.getLatestAssessment()]);
  const nativeLanguage = profile?.native_language ?? "the user's native language";

  const basicProfile = profile
    ? `\n\n## Learner Profile\nName: ${profile.name ?? "unknown"} | Native language: ${profile.native_language} | Level: ${profile.level ?? "unknown"} | Goal: ${profile.goal ?? "none"} | Correction style: ${profile.correction_style ?? "inline"}`
    : `\n\n## Learner Profile\nNot configured yet — begin onboarding when user sends /start.`;

  const words = await getDueWords(db, 5);
  const weakAreas = await getWeakAreas(db, 3);
  const errorInfo = weakAreas.length > 0 ? await getRecentErrorForCategory(db, weakAreas[0]) : null;
  const strengths = parseJsonOrEmpty<string>(assessment?.strengths as string | null);

  const hasLearnerData =
    assessment != null ||
    words.length > 0 ||
    errorInfo != null ||
    weakAreas.length > 0;

  const learnerProfile = hasLearnerData
    ? formatProfile(assessment, words, errorInfo, weakAreas, strengths)
    : null;

  const interests = await db.listInterests(10);
  const userInterests = interests.length > 0
    ? `\n\n## User Interests\n${interests.join(", ")}`
    : null;

  return { basicProfile, learnerProfile, userInterests, nativeLanguage };
}

function formatProfile(
  assessment: Record<string, unknown> | null,
  words: string[],
  errorInfo: { user_text: string; correct: string; category: string } | null,
  weakAreas: string[],
  strengths: string[],
): string {
  const lines: string[] = ["\n\n## Current Learner Profile"];

  if (assessment) {
    const level = assessment.cefr_level as string;
    const confidence = assessment.confidence as number | null;
    const confPct = confidence != null ? Math.round(confidence * 100) : 0;
    lines.push(`**CEFR Level**: ${level} (confidence: ${confPct}%)`);
  }

  if (weakAreas.length > 0) {
    lines.push(`**Weak Areas**: ${weakAreas.join(", ")}`);
  }

  if (words.length > 0) {
    lines.push(`**Words to Weave In**: ${words.join(", ")}`);
  }

  if (errorInfo) {
    lines.push(`**Error to Reinforce**: "${errorInfo.user_text}" → "${errorInfo.correct}" (${errorInfo.category})`);
  }

  if (strengths.length > 0) {
    lines.push(`**Strengths**: ${strengths.join(", ")}`);
  }

  return lines.join("\n");
}

async function getDueWords(db: BuddyDb, limit: number): Promise<string[]> {
  try {
    const rows = await db.dueVocab(limit);
    return rows.map((r) => r.word);
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

function parseJsonOrEmpty<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
