import fs from "fs";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { ErrorRepository, ProfileRepository, InterestRepository, CompetencyRepository, SessionRepository, LearningRepository } from "../repositories/interfaces.js";
import type { ConversationStateResult } from "../domain/types.js";
import { getCompetencyVector, selectFocusAxis, renderCalibration } from "../domain/competency.js";

export interface PromptRepos {
  errors: ErrorRepository;
  profile: ProfileRepository;
  langProfile: ProfileRepository;
  interests: InterestRepository;
  competency: CompetencyRepository;
  session: SessionRepository;
  learning: LearningRepository;
}

interface ProfileInjection {
  basicProfile: string;
  learnerProfile: string | null;
  calibration: string | null;
  userInterests: string | null;
  dreamMemory: string | null;
  openerPolicy: string | null;
}

export interface PromptBuildOptions {
  sourceType?: "user_chat" | "cron" | "proactive" | "system";
}

export class PromptBuilder {
  constructor(private repos: PromptRepos, private lang: LanguageConfig) {}

  async build(userMessage?: string, dreamMemoryPath?: string, options: PromptBuildOptions = {}): Promise<string> {
    const soulContent = this.lang.soulContent ?? fs.readFileSync(this.lang.soulPath, "utf-8");
    const convState = await this.repos.session.getConversationState();
    const { basicProfile, learnerProfile, calibration, userInterests, dreamMemory, openerPolicy } =
      await this._buildInjection(userMessage, dreamMemoryPath, convState, options);

    let fullSystem = this.lang.promptText.languageBlock + soulContent + this.renderProductPolicy() + basicProfile;
    if (dreamMemory) fullSystem += dreamMemory;
    if (learnerProfile) fullSystem += learnerProfile;
    if (calibration) fullSystem += calibration;
    if (userInterests) fullSystem += userInterests;
    if (openerPolicy) fullSystem += openerPolicy;

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
    options: PromptBuildOptions = {},
  ): Promise<ProfileInjection> {
    const sharedProfile = await this.repos.profile.getProfile();
    const langProfile = await this.repos.langProfile.getProfile();

    const name = sharedProfile?.name ?? null;
    const goal = langProfile?.goal ?? null;
    const hasProfile = name || goal;

    const basicProfile = hasProfile
      ? this.lang.promptText.learnerProfileConfigured(name ?? "—", goal ?? "—")
      : this.lang.promptText.learnerProfileUnconfigured;

    let calibration: string | null = null;
    try {
      const cv = await this._buildCompetencyVector();
      const focus = selectFocusAxis(cv, this.lang);
      calibration = `\n\n${renderCalibration(cv, focus, this.lang)}`;
    } catch {}

    const weakAreas = await this._getWeakAreas(3);
    const errorInfo = weakAreas.length > 0 ? await this._getRecentErrorForCategory(weakAreas[0]) : null;

    const isAutonomousOpener = options.sourceType === "cron" || options.sourceType === "proactive";
    const wantsPractice = this.detectPracticeIntent(userMessage);
    const rawDueLearningItems = await this._getDueLearningItems(5);
    const dueLearningItems = isAutonomousOpener || wantsPractice
      ? rawDueLearningItems
      : this.filterDueLearningItemsForUserTurn(rawDueLearningItems, userMessage).slice(0, 5);
    const hasLearnerData = errorInfo != null || weakAreas.length > 0 || dueLearningItems.length > 0;
    const learnerProfileBase = hasLearnerData
      ? this.lang.promptText.currentLearnerProfile({ receptiveWords: [], productiveWords: [], errorInfo, weakAreas })
      : null;
    const learnerProfile = dueLearningItems.length > 0
      ? isAutonomousOpener
        ? `${learnerProfileBase ?? ""}\n\n## Optional learning hooks due\n${this.renderDueLearningItems(dueLearningItems)}\nThese items are optional hooks for an autonomous opener, not the agenda. Do not let due items override opener variety; choose a due item only if it makes a fresh, natural start. If the due items cluster around the same recent topic, prefer a different interest, stable memory, or neutral opener instead.`
        : wantsPractice
          ? `${learnerProfileBase ?? ""}\n\n## Explicit practice request: due learning items\n${this.renderDueLearningItems(dueLearningItems)}\nThe learner explicitly asked to practice saved/pending material. Pick exactly one item from this list and make a tiny conversational production task from that item itself. Do not steer to unrelated memories, hobbies, or recent topics unless the learner named that topic in the latest message. Respect exclusions like "sin gimnasio". No quiz list and no /practice mode.`
          : `${learnerProfileBase ?? ""}\n\n## Conversation-native learning items due\n${this.renderDueLearningItems(dueLearningItems)}\nThese are priority learning targets. Weave exactly one into this turn when at all plausible; for high-pressure items, prefer an active-production opportunity (a natural cue, micro-cloze, or short follow-up) over mere exposure. Keep it conversational, do not dump a quiz list, and do not create a /practice mode.`
      : learnerProfileBase;

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
      : isAutonomousOpener && allInterests.length > 0
        ? `\n\n## ${this.lang.interestsHeader}\n${this.selectAutonomousInterests(allInterests, 30).join(", ")}\nThese are possible conversation hooks, not an agenda. For an autonomous opener, you may choose any one interest, including an older one, if it would feel fresh and natural. Do not always choose the most recent interest and do not keep returning to the same topic.`
      : null;

    let dreamMemory: string | null = null;
    if (dreamMemoryPath && fs.existsSync(dreamMemoryPath)) {
      const content = fs.readFileSync(dreamMemoryPath, "utf8").trim();
      if (content) dreamMemory = this.lang.promptText.dreamMemory(content);
    }

    const openerPolicy = isAutonomousOpener
      ? this.renderAutonomousOpenerPolicy(allInterests, Boolean(dreamMemory), dueLearningItems.length > 0)
      : null;

    return { basicProfile, learnerProfile, calibration, userInterests, dreamMemory, openerPolicy };
  }

  private renderAutonomousOpenerPolicy(interests: string[], hasDreamMemory: boolean, hasDueLearningItems: boolean): string {
    const interestLine = interests.length > 0
      ? `Available interests include: ${this.selectAutonomousInterests(interests, 20).join(", ")}.`
      : "No explicit interest list is available; use memory or a neutral opener instead.";
    return [
      "\n\n## Autonomous conversation opener policy",
      "This is a morning/evening/proactive start, not a reply to a user question.",
      "Do NOT assume the new conversation must continue the previous thread or attach recent messages as the agenda.",
      "Choose one light hook and open naturally in Spanish:",
      "- recent thread, only sometimes;",
      hasDreamMemory ? "- one stable personal fact or autobiographical memory from `Memoria de sueño`;" : "- a stable personal fact if present elsewhere in the prompt;",
      "- one interest from the long-term interest pool, including older interests;",
      hasDueLearningItems ? "- one due learning item, woven naturally rather than as a quiz;" : "- a gentle language-learning hook if it fits;",
      "- or a fresh neutral opener with no memory reference.",
      "Use memory like a human: lightly, variably, and without sounding like a CRM log. Do not say 'yesterday we talked about...' by default.",
      "If you use an old fact (for example a trip, place, hobby, book, music, training, landscape), make it feel like a conversational invitation, not a recap.",
      interestLine,
    ].join("\n");
  }

  private renderDueLearningItems(items: Array<{ id: number; title: string; type: string; passive_score: number; active_score: number; reactivation_pressure: string }>): string {
    return items
      .map((i) => `- #${i.id} ${i.title} (${i.type}; passive=${Number(i.passive_score).toFixed(2)}, active=${Number(i.active_score).toFixed(2)}, pressure=${i.reactivation_pressure})`)
      .join("\n");
  }

  private detectPracticeIntent(userMessage?: string): boolean {
    if (!userMessage?.trim()) return false;
    const message = this.normalizeForMatching(userMessage);
    // ponytail: generic practice intent only; topic/source ranking can move into the repository if this grows.
    return /\b(practic|repas|ejercit|revis)/u.test(message)
      || /\b(lo pendiente|pendientes|material guardado|algo guardado|learning items)\b/u.test(message);
  }

  private filterDueLearningItemsForUserTurn<T extends { title: string; type: string }>(items: T[], userMessage?: string): T[] {
    if (!userMessage?.trim()) return [];
    const message = this.normalizeForMatching(userMessage);
    const messageTokens = new Set(this.matchTokens(userMessage));
    return items.filter((item) => {
      if (item.type === "correction") {
        const leftSide = item.title.split(/→|->/)[0]?.trim();
        if (leftSide && message.includes(this.normalizeForMatching(leftSide))) return true;
      }
      return this.matchTokens(item.title).some((token) => messageTokens.has(token));
    });
  }

  private normalizeForMatching(text: string): string {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  private matchTokens(text: string): string[] {
    const stop = new Set(["para", "pero", "porque", "como", "mucho", "mucha", "tiempo", "tener", "tenido", "descansar", "descanso"]);
    return this.normalizeForMatching(text).match(/[\p{L}\p{N}]{4,}/gu)?.filter((token) => !stop.has(token)) ?? [];
  }

  private interestCluster(interest: string): string {
    const lower = interest.toLowerCase();
    if (/gimnas|gym|entren|ejerc|calisten|peso|pesas|squat|fuerza|fitness/.test(lower)) return "training";
    if (/viaj|canarias|tenerife|teide|montañ|sender|paisaj|bosque|mar|playa|vacacion|ruta|excurs/.test(lower)) return "travel-nature";
    if (/músic|ritmo|hardcore|canc/i.test(lower)) return "music";
    if (/libro|lect|ciencia ficción|película|cine/.test(lower)) return "culture";
    if (/fútbol|mundial|deporte/.test(lower)) return "sports";
    if (/trabajo|teletrabajo|proyecto/.test(lower)) return "work";
    return lower.split(/\s+/)[0] || "other";
  }

  private selectAutonomousInterests(interests: string[], limit: number): string[] {
    const selected: string[] = [];
    const seen = new Set<string>();
    const clusterCounts = new Map<string, number>();
    const add = (interest: string, maxPerCluster: number) => {
      const clean = interest.trim();
      if (!clean || seen.has(clean.toLowerCase()) || selected.length >= limit) return;
      const cluster = this.interestCluster(clean);
      const count = clusterCounts.get(cluster) ?? 0;
      if (count >= maxPerCluster) return;
      selected.push(clean);
      seen.add(clean.toLowerCase());
      clusterCounts.set(cluster, count + 1);
    };

    for (const interest of interests) add(interest, 1);
    for (const interest of interests) add(interest, 2);
    return selected.slice(0, limit);
  }

  private async _buildCompetencyVector() {
    return getCompetencyVector(this.repos);
  }

  private async _getDueLearningItems(limit: number) {
    try {
      if (!this.repos.learning) return [];
      const items = await this.repos.learning.listDueLearningItems(limit);
      return items;
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
  ): Promise<{ user_text: string; correct: string; category: string; explanation?: string } | null> {
    try {
      const errors = await this.repos.errors.listErrors(category, 1);
      if (errors.length === 0) return null;
      const e = errors[0];
      return { user_text: e.user_text, correct: e.correct_form, category: e.category, explanation: this.lang.errorExplanations[e.category] };
    } catch {
      return null;
    }
  }
}
