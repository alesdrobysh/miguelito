import fs from "fs";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { VocabRepository, ErrorRepository, ProfileRepository, InterestRepository, CompetencyRepository, SessionRepository } from "../repositories/interfaces.js";
import { getCompetencyVector, selectFocusAxis, renderCalibration } from "../domain/competency.js";

export interface PromptRepos {
  vocab: VocabRepository;
  errors: ErrorRepository;
  profile: ProfileRepository;
  interests: InterestRepository;
  competency: CompetencyRepository;
  session: SessionRepository;
}

interface ProfileInjection {
  basicProfile: string;
  learnerProfile: string | null;
  calibration: string | null;
  userInterests: string | null;
  dreamMemory: string | null;
}

export class PromptBuilder {
  constructor(private repos: PromptRepos, private lang: LanguageConfig) {}

  async build(userMessage?: string, dreamMemoryPath?: string): Promise<string> {
    const soulContent = fs.readFileSync(this.lang.soulPath, "utf-8");
    const { basicProfile, learnerProfile, calibration, userInterests, dreamMemory } =
      await this._buildInjection(userMessage, dreamMemoryPath);

    const langName = this.lang.name;
    let fullSystem = `## Language\nYou are a ${langName} tutor. Respond in ${langName} — ALL output must be in ${langName}. The learner is learning ${langName}.\n\n` + soulContent + basicProfile;
    if (dreamMemory) fullSystem += dreamMemory;
    if (learnerProfile) fullSystem += learnerProfile;
    if (calibration) fullSystem += calibration;
    if (userInterests) fullSystem += userInterests;

    const convState = await this.repos.session.getConversationState();
    fullSystem += `\n\n## Conversation State
Turn count: ${convState.session.turn_count}
Last modes: ${convState.session.last_two_modes}
Mood hint: ${convState.session.mood_hint ?? "neutral"}
Topics touched: ${convState.session.topics_touched}
`;

    return fullSystem;
  }

  /**
   * Returns a short instruction to be placed AFTER the chat history.
   */
  buildPostHistoryReminder(): string {
    return `Reminder: You are a ${this.lang.name} language tutor. Respond ONLY in ${this.lang.name}. NEVER output mode names, system markers, internal state, or meta-commentary — the learner must only see natural ${this.lang.name} text. Keep it brief (1-3 sentences). Check ## Learner Profile for the user's name and greet them accordingly.`;
  }

  private async _buildInjection(userMessage?: string, dreamMemoryPath?: string): Promise<ProfileInjection> {
    const profile = await this.repos.profile.getProfile();

    const basicProfile = profile
      ? `\n\n## Learner Profile\nName: ${profile.name ?? "unknown"} | Goal: ${profile.goal ?? "none"} | Correction style: ${profile.correction_style ?? "inline"}`
      : `\n\n## Learner Profile\nNot configured yet — begin onboarding when user sends /start.`;

    let calibration: string | null = null;
    try {
      const cv = await this._buildCompetencyVector();
      const focus = selectFocusAxis(cv, this.lang);
      calibration = `\n\n${renderCalibration(cv, focus, this.lang)}`;
    } catch {}

    const words = await this._getDueWords(5);
    const weakAreas = await this._getWeakAreas(3);
    const errorInfo = weakAreas.length > 0 ? await this._getRecentErrorForCategory(weakAreas[0]) : null;

    const hasLearnerData = words.length > 0 || errorInfo != null || weakAreas.length > 0;
    const learnerProfile = hasLearnerData ? formatProfile(words, errorInfo, weakAreas) : null;

    // Dynamic Interest Injection
    const allInterests = await this.repos.interests.listInterests(100);
    let selectedInterests: string[] = [];

    if (userMessage) {
      const lowerMsg = userMessage.toLowerCase();
      selectedInterests = allInterests.filter(interest => 
        lowerMsg.includes(interest.toLowerCase())
      );
    }

    if (selectedInterests.length === 0) {
      selectedInterests = shuffleArray(allInterests).slice(0, 2);
    }

    const userInterests = selectedInterests.length > 0
      ? `\n\n## ${this.lang.interestsHeader}\n${selectedInterests.join(", ")}`
      : null;

    let dreamMemory: string | null = null;
    if (dreamMemoryPath && fs.existsSync(dreamMemoryPath)) {
      const content = fs.readFileSync(dreamMemoryPath, "utf8").trim();
      if (content) dreamMemory = `\n\n## Dream Memory\n${content}`;
    }

    return { basicProfile, learnerProfile, calibration, userInterests, dreamMemory };
  }

  private async _buildCompetencyVector() {
    return getCompetencyVector(this.repos);
  }

  private async _getDueWords(limit: number): Promise<string[]> {
    try {
      const rows = await this.repos.vocab.dueVocab(limit);
      return rows.map((r) => r.chunk_l2);
    } catch {
      return [];
    }
  }

  private async _getWeakAreas(limit: number): Promise<string[]> {
    try {
      const allErrors = await this.repos.errors.listErrors("all", 1000);
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

  private async _getRecentErrorForCategory(
    category: string,
  ): Promise<{ user_text: string; correct: string; category: string } | null> {
    try {
      const errors = await this.repos.errors.listErrors(category, 1);
      if (errors.length === 0) return null;
      const e = errors[0];
      return { user_text: e.user_text, correct: e.correct_form, category: e.category };
    } catch {
      return null;
    }
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatProfile(
  words: string[],
  errorInfo: { user_text: string; correct: string; category: string } | null,
  weakAreas: string[],
): string {
  const lines: string[] = ["\n\n## Current Learner Profile"];
  if (weakAreas.length > 0) lines.push(`**Weak Areas**: ${weakAreas.join(", ")}`);
  if (words.length > 0) lines.push(`**Words to Weave In**: ${words.join(", ")}`);
  if (errorInfo) lines.push(`**Error to Reinforce**: "${errorInfo.user_text}" → "${errorInfo.correct}" (${errorInfo.category})`);
  return lines.join("\n");
}
