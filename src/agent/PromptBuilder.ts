import fs from "fs";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { VocabRepository, ErrorRepository, ProfileRepository, InterestRepository, CompetencyRepository, SessionRepository } from "../repositories/interfaces.js";
import type { ConversationStateResult } from "../domain/types.js";
import { getCompetencyVector, selectFocusAxis, renderCalibration } from "../domain/competency.js";
import { VocabularyReviewPlanner } from "./VocabularyReviewPlanner.js";

export interface PromptRepos {
  vocab: VocabRepository;
  errors: ErrorRepository;
  profile: ProfileRepository;
  langProfile: ProfileRepository;
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
    const convState = await this.repos.session.getConversationState();
    const { basicProfile, learnerProfile, calibration, userInterests, dreamMemory } =
      await this._buildInjection(userMessage, dreamMemoryPath, convState);

    let fullSystem = this.lang.promptText.languageBlock + soulContent + this.renderProductPolicy() + basicProfile;
    if (dreamMemory) fullSystem += dreamMemory;
    if (learnerProfile) fullSystem += learnerProfile;
    if (calibration) fullSystem += calibration;
    if (userInterests) fullSystem += userInterests;

    fullSystem += this.lang.promptText.conversationState(
      convState.session.turn_count,
      convState.session.last_two_modes,
      convState.session.mood_hint ?? "neutral",
      convState.session.topics_touched,
    );

    return fullSystem;
  }

  /**
   * Returns a short instruction to be placed AFTER the chat history.
   */
  buildPostHistoryReminder(): string {
    return this.lang.promptText.postHistoryReminder;
  }

  private renderProductPolicy(): string {
    const policy = this.lang.productPolicy;
    return [
      "\n\n## Product policy",
      `${policy.name}: ${policy.mission}`,
      `Learner level: ${policy.learnerLevel}.`,
      `Input policy: ${policy.inputPolicy}`,
      `Correction policy: ${policy.correctionPolicy}`,
      `Session stance: ${policy.visibleSummary}`,
      "",
      "## Tutor tools",
      "Default: talk naturally. When needed: explain, correct, drill, review.",
      "Recognize these user intents and switch briefly without exposing mode names: conversation, correct, explain, grammar practice, vocabulary practice, review, recap.",
      "Conversation remains the default surface; tool-like teaching moments should be short, contextual, and return to the dialogue when the user is done.",
      policy.toolPolicy,
    ].join("\n");
  }

  private async _buildInjection(
    userMessage?: string,
    dreamMemoryPath?: string,
    convState?: ConversationStateResult,
  ): Promise<ProfileInjection> {
    const sharedProfile = await this.repos.profile.getProfile();
    const langProfile = await this.repos.langProfile.getProfile();

    const name = sharedProfile?.name ?? null;
    const correctionStyle = sharedProfile?.correction_style ?? null;
    const goal = langProfile?.goal ?? null;
    const hasProfile = name || correctionStyle || goal;

    const basicProfile = hasProfile
      ? this.lang.promptText.learnerProfileConfigured(name ?? "—", goal ?? "—", correctionStyle ?? "inline")
      : this.lang.promptText.learnerProfileUnconfigured;

    let calibration: string | null = null;
    try {
      const cv = await this._buildCompetencyVector();
      const focus = selectFocusAxis(cv, this.lang);
      calibration = `\n\n${renderCalibration(cv, focus, this.lang)}`;
    } catch {}

    const reviewPlan = await new VocabularyReviewPlanner(this.repos.vocab).select({
      turnCount: convState?.session.turn_count ?? 0,
    });
    const productiveWords = reviewPlan.productiveWords;
    const receptiveWords = reviewPlan.receptiveWords;
    const weakAreas = await this._getWeakAreas(3);
    const errorInfo = weakAreas.length > 0 ? await this._getRecentErrorForCategory(weakAreas[0]) : null;

    const hasLearnerData = receptiveWords.length > 0 || productiveWords.length > 0 || errorInfo != null || weakAreas.length > 0;
    const learnerProfile = hasLearnerData
      ? this.lang.promptText.currentLearnerProfile({ receptiveWords, productiveWords, errorInfo, weakAreas })
      : null;

    // Dynamic Interest Injection
    // Interests are background context, not an agenda. Only surface interests that
    // are already relevant to the current user message; otherwise let the latest
    // turn lead so the bot does not keep dragging the chat back to old topics.
    const allInterests = await this.repos.interests.listInterests(100);
    let selectedInterests: string[] = [];

    if (userMessage) {
      const lowerMsg = userMessage.toLowerCase();
      selectedInterests = allInterests
        .filter((interest) => lowerMsg.includes(interest.toLowerCase()))
        .slice(0, 2);
    }

    const userInterests = selectedInterests.length > 0
      ? `\n\n## ${this.lang.interestsHeader}\n${selectedInterests.join(", ")}\nUse these only as optional background for this turn. Do not steer the conversation toward these interests unless the user's latest message naturally invites it. Do not keep returning to the same interest across turns; vary topics and let the user's latest message lead.`
      : null;

    let dreamMemory: string | null = null;
    if (dreamMemoryPath && fs.existsSync(dreamMemoryPath)) {
      const content = fs.readFileSync(dreamMemoryPath, "utf8").trim();
      if (content) dreamMemory = this.lang.promptText.dreamMemory(content);
    }

    return { basicProfile, learnerProfile, calibration, userInterests, dreamMemory };
  }

  private async _buildCompetencyVector() {
    return getCompetencyVector(this.repos);
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
