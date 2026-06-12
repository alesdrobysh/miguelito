import type { ChatMessage } from "../llm.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { CompetencyRepository, ErrorRepository, InterestRepository, LearningRepository, SessionRepository } from "../repositories/interfaces.js";
import type { LearningItem, LearningItemEvidenceInput, LearningItemInput, TurnAnnotationInput } from "../domain/types.js";
import { analyzeTextDifficulty, outcomeScore } from "../domain/frequency.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: "postturn" });

export interface PostTurnProcessorDeps {
  provider: LLMProvider;
  errors: ErrorRepository;
  competency: CompetencyRepository;
  session: SessionRepository;
  interests?: InterestRepository;
  learning: LearningRepository;
  lang: LanguageConfig;
}

export interface PostTurnProcessInput {
  userMessage: string;
  assistantText: string;
  chatHistory: ChatMessage[];
}

interface EvaluatedError {
  user_text?: string;
  correct?: string;
  category?: string;
  note?: string;
}

interface EvaluatedVocab {
  word?: string;
  context?: string;
  anchor?: string;
  reason?: string;
  priority?: number | string;
  meaning?: string;
  topic_tags?: string[];
  acceptable_variants?: string[];
  elicitation_cues?: string[];
}

interface EvaluatedLearningItem {
  type?: string;
  title?: string;
  prompt_l2?: string;
  explanation?: string;
  explanation_l1?: string;
  source_type?: string;
  evidence_snippet?: string;
  priority?: number | string;
  practice_modes?: string[];
  tags?: string[];
}


interface EvaluatedLearningItemEvidence {
  learning_item_id?: number | string;
  skill?: string;
  event?: string;
  independence?: string;
  score_delta?: number | string;
  confidence?: number | string;
  evidence_snippet?: string;
  source_type?: string;
  source_message_id?: number | string;
}

interface PostTurnEvaluation {
  annotation?: Partial<TurnAnnotationInput>;
  mode?: string;
  errors?: EvaluatedError[];
  vocabulary?: EvaluatedVocab[];
  learning_items?: EvaluatedLearningItem[];
  item_evidence?: EvaluatedLearningItemEvidence[];
  interests?: string[];
}

export interface PostTurnProcessResult {
  ok: boolean;
  errorsLogged: number;
  learningItemsAdded: number;
  learningEvidenceAdded: number;
  annotationInserted: boolean;
  interestsAdded: number;
}

const VALID_COMPREHENSION = new Set(["smooth", "asked_clarify", "requested_simpler"]);
const VALID_MODES = new Set(["REACT", "DIG", "OFFER", "TEACH", "PLAY"]);

export class PostTurnProcessor {
  constructor(private deps: PostTurnProcessorDeps) {}

  async process(input: PostTurnProcessInput): Promise<PostTurnProcessResult> {
    const evaluation = await this.evaluate(input);
    if (!evaluation) return this.emptyResult(false);
    return this.apply(evaluation, input);
  }

  private emptyResult(ok: boolean): PostTurnProcessResult {
    return { ok, errorsLogged: 0, learningItemsAdded: 0, learningEvidenceAdded: 0, annotationInserted: false, interestsAdded: 0 };
  }

  private async evaluate(input: PostTurnProcessInput): Promise<PostTurnEvaluation | null> {
    const systemPrompt = [
      `You are a deterministic evaluator for a ${this.deps.lang.name} tutoring chatbot.`,
      "Return only JSON. Do not write learner-facing text.",
      "Extract post-turn learning events from the latest user message and assistant reply.",
      "This evaluator, not the chat model, owns annotation, error extraction, and learning-item evidence.",
      `Valid error categories: ${this.deps.lang.errorCategories.join(", ")}.`,
      "Schema:",
      JSON.stringify({
        annotation: {
          obligatory: [{ type: "category_from_valid_list" }],
          used: ["construction actually produced by learner"],
          naturalness: 1,
          comprehension: "smooth|asked_clarify|requested_simpler",
          lexical_rarity: 0.0,
          tunit_length: 1,
          had_subordination: false,
        },
        mode: "REACT|DIG|OFFER|TEACH|PLAY",
        errors: [{ user_text: "wrong learner text", correct: "correct form", category: "category", note: "short note" }],
        learning_items: [{ type: "grammar_point|correction|phrase|word|collocation|idiom|register_note|pronunciation", title: "por vs para", prompt_l2: "optional L2 prompt", explanation_l1: "short explanation", source_type: "user_question|conversation|correction", priority: "0.9=correction/explicitly asked, 0.7=useful, 0.5=niche", practice_modes: ["short_drill"] }],
        item_evidence: [{ learning_item_id: 123, skill: "passive|active|reactivation", event: "recognized|responded_appropriately|asked_clarification|misunderstood|spontaneous_production|elicited_production|hinted_production|self_correction|incorrect_production|avoidance|assistant_reintroduced", independence: "spontaneous|elicited|hinted|observed", score_delta: "-0.2..0.3", confidence: "0..1", evidence_snippet: "short quote" }],
        interests: ["hobby or topic the learner mentioned (lowercase, e.g. 'fútbol', 'cocina')"],
      }),
      "Use empty arrays when there is nothing to extract. For interests: extract hobbies, topics, or preferences the learner mentioned; use lowercase; omit generic words like 'español' or 'idiomas'.",
      "Capture all reusable material as learning_items only; do not create separate review queues or table-specific artifacts.",
    ].join("\n");

    const recent = input.chatHistory.slice(-8).map((m) => `${m.role}: ${m.content}`).join("\n");
    const activeItems = await this.recentLearningItemsForEvaluation(input);
    const userPrompt = [
      "Recent history:",
      recent || "(none)",
      "Active learning items that may receive item_evidence (use these ids only):",
      activeItems,
      "Latest learner message:",
      input.userMessage,
      "Assistant reply:",
      input.assistantText,
    ].join("\n\n");

    try {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.deps.provider.completeJson<PostTurnEvaluation>(systemPrompt, userPrompt, {
            temperature: 0,
            maxTokens: 1200,
            structured: true,
            timeoutMs: 60_000,
          });
        } catch (err) {
          lastErr = err;
          if (!this.isTransientEvaluatorError(err) || attempt === 2) throw err;
        }
      }
      throw lastErr;
    } catch (err) {
      log.warn({ err }, "post-turn evaluation failed");
      return null;
    }
  }

  private async apply(evaluation: PostTurnEvaluation, _input: PostTurnProcessInput): Promise<PostTurnProcessResult> {
    let errorsLogged = 0;
    let learningItemsAdded = 0;
    let learningEvidenceAdded = 0;
    let annotationInserted = false;
    let interestsAdded = 0;

    const morphologyTypes = new Set(this.deps.lang.morphologyCategories);
    const morphologyErrors = (evaluation.errors ?? []).filter((e) => {
      const cat = this.clean(e.category).toLowerCase();
      return morphologyTypes.has(cat);
    }).length;
    const { session } = await this.deps.session.getConversationState();
    const annotation = this.normalizeAnnotation(evaluation.annotation, _input, morphologyErrors, session.session_id, session.turn_count);
    await this.deps.competency.insertTurnAnnotation(annotation);
    await this.recordDifficultyWeightedEvidence(annotation, _input);
    annotationInserted = true;

    const mode = typeof evaluation.mode === "string" ? evaluation.mode.trim().toUpperCase() : "";
    if (VALID_MODES.has(mode)) {
      await this.deps.session.updateConversationState(mode);
    }

    for (const item of evaluation.errors ?? []) {
      const userText = this.clean(item.user_text);
      const correct = this.clean(item.correct);
      if (!userText || !correct) continue;
      const category = this.validCategory(item.category);
      await this.deps.errors.logError(userText, correct, category, this.clean(item.note));
      errorsLogged++;
    }

    for (const item of evaluation.vocabulary ?? []) {
      const word = this.clean(item.word).toLowerCase();
      if (!word) continue;
      const learningId = await this.learningRepo().addLearningItem({
        type: "phrase",
        title: word,
        prompt_l2: this.clean(item.context),
        explanation_l1: this.clean(item.meaning) || this.clean(item.reason) || undefined,
        source_type: evaluation.errors?.length ? "correction" : "conversation",
        evidence_snippet: this.clean(item.context) || _input.userMessage,
        priority: Math.max(0, Math.min(1, Number(item.priority ?? 0.6) || 0.6)),
        practice_modes: ["active_production", "cloze"],
        tags: Array.isArray(item.topic_tags) ? item.topic_tags.map((x) => String(x)).filter(Boolean) : [],
      });
      if (learningId !== null) learningItemsAdded++;
    }

    for (const item of evaluation.errors ?? []) {
      const userText = this.clean(item.user_text);
      const correct = this.clean(item.correct);
      if (!userText || !correct) continue;
      const learningId = await this.learningRepo().addLearningItem({
        type: "correction",
        title: `${userText} → ${correct}`,
        prompt_l2: userText,
        explanation_l1: this.clean(item.note) || undefined,
        source_type: "correction",
        evidence_snippet: _input.userMessage,
        priority: 0.9,
        practice_modes: ["rewrite"],
      });
      if (learningId !== null) learningItemsAdded++;
    }

    const appliedCorrections = (evaluation.errors ?? [])
      .map((e) => ({ userText: this.clean(e.user_text), correct: this.clean(e.correct) }))
      .filter((e) => e.userText && e.correct);
    for (const item of evaluation.learning_items ?? []) {
      const input = this.learningItemInput(item, _input);
      if (!input || this.isDuplicateCorrectionLearningItem(input, appliedCorrections)) continue;
      const learningId = await this.learningRepo().addLearningItem(input);
      if (learningId !== null) learningItemsAdded++;
    }

    for (const item of evaluation.item_evidence ?? []) {
      const evidence = this.learningItemEvidenceInput(item);
      if (!evidence) continue;
      try {
        await this.learningRepo().recordLearningItemEvidence(evidence);
        learningEvidenceAdded++;
      } catch (err) {
        log.warn({ err, item }, "learning item evidence ignored");
      }
    }


    if (this.deps.interests) {
      for (const raw of evaluation.interests ?? []) {
        const interest = this.clean(raw).toLowerCase();
        if (interest && interest.length <= 100) {
          const added = await this.deps.interests.addInterest(interest, "conversation", 0.7);
          if (added) interestsAdded++;
        }
      }
    }

    return { ok: true, errorsLogged, learningItemsAdded, learningEvidenceAdded, annotationInserted, interestsAdded };
  }

  private learningRepo(): LearningRepository {
    return this.deps.learning;
  }

  private async recentLearningItemsForEvaluation(input: PostTurnProcessInput): Promise<string> {
    try {
      const items = await this.learningRepo().selectLearningItemsForEvaluation(input.userMessage, input.assistantText, 80);
      if (items.length === 0) return "[]";
      return JSON.stringify(items.map((i: LearningItem) => ({ id: i.id, type: i.type, title: i.title, prompt_l2: i.prompt_l2, passive_score: i.passive_score, active_score: i.active_score, stability: i.stability, last_reactivated_at: i.last_reactivated_at })));
    } catch {
      try {
        const items = await this.learningRepo().listLearningItems("active", 30);
        return JSON.stringify(items.map((i: LearningItem) => ({ id: i.id, type: i.type, title: i.title, prompt_l2: i.prompt_l2, passive_score: i.passive_score, active_score: i.active_score, stability: i.stability })));
      } catch {
        return "[]";
      }
    }
  }

  private learningItemInput(item: EvaluatedLearningItem, input: PostTurnProcessInput): LearningItemInput | null {
    const title = this.clean(item.title);
    if (!title) return null;
    return {
      type: this.clean(item.type) || "phrase",
      title,
      prompt_l2: this.clean(item.prompt_l2) || undefined,
      explanation_l1: this.clean(item.explanation_l1) || this.clean(item.explanation) || undefined,
      source_type: this.clean(item.source_type) || "user_question",
      evidence_snippet: this.clean(item.evidence_snippet) || input.userMessage,
      priority: Math.max(0, Math.min(1, Number(item.priority ?? 0.7) || 0.7)),
      practice_modes: Array.isArray(item.practice_modes) ? item.practice_modes.map((x) => String(x)).filter(Boolean) : [],
      tags: Array.isArray(item.tags) ? item.tags.map((x) => String(x)).filter(Boolean) : [],
    };
  }

  private learningItemEvidenceInput(item: EvaluatedLearningItemEvidence): LearningItemEvidenceInput | null {
    const learningItemId = Number(item.learning_item_id ?? 0);
    const event = this.clean(item.event);
    if (!learningItemId || !event) return null;
    const sourceMessageId = item.source_message_id == null ? undefined : Number(item.source_message_id);
    return {
      learning_item_id: learningItemId,
      skill: this.clean(item.skill) || "passive",
      event,
      independence: this.clean(item.independence) || "unknown",
      score_delta: Number(item.score_delta ?? 0) || 0,
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.5) || 0.5)),
      evidence_snippet: this.clean(item.evidence_snippet) || undefined,
      source_type: this.clean(item.source_type) || "conversation",
      source_message_id: Number.isFinite(sourceMessageId) && sourceMessageId! > 0 ? sourceMessageId : undefined,
    };
  }

  private isDuplicateCorrectionLearningItem(input: LearningItemInput, corrections: Array<{ userText: string; correct: string }>): boolean {
    if (corrections.length === 0) return false;
    const title = this.normalizeForDedupe(input.title);
    const sourceType = this.clean(input.source_type).toLowerCase();
    if (input.type === "correction" || sourceType === "correction") return true;
    return corrections.some((c) => {
      const user = this.normalizeForDedupe(c.userText);
      const correct = this.normalizeForDedupe(c.correct);
      return (correct.length > 2 && title.includes(correct)) || (user.length > 2 && title.includes(user));
    });
  }

  private normalizeForDedupe(value: unknown): string {
    return this.clean(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  private normalizeAnnotation(raw: Partial<TurnAnnotationInput> | undefined, input: PostTurnProcessInput, morphologyErrors: number, sessionId?: string, turnNumber?: number): TurnAnnotationInput {
    const validCategories = new Set(this.deps.lang.errorCategories);
    const morphologyTypes = new Set(this.deps.lang.morphologyCategories);
    const obligatory = Array.isArray(raw?.obligatory)
      ? raw!.obligatory
          .map((o) => ({ type: this.clean((o as { type?: string }).type) }))
          .filter((o) => validCategories.has(o.type))
      : [];
    const used = Array.isArray(raw?.used) ? raw!.used.map((u) => String(u)).filter(Boolean) : [];
    const naturalnessRaw = Number(raw?.naturalness ?? 1);
    const naturalness = Number.isFinite(naturalnessRaw) ? Math.max(0, Math.min(1, naturalnessRaw)) : 1;
    const comprehensionRaw = this.clean(raw?.comprehension) || "smooth";
    const comprehension = VALID_COMPREHENSION.has(comprehensionRaw)
      ? (comprehensionRaw as "smooth" | "asked_clarify" | "requested_simpler")
      : "smooth";
    const assistantDifficulty = analyzeTextDifficulty(input.assistantText, this.deps.lang);
    const modelRarity = Math.max(0, Math.min(1, Number(raw?.lexical_rarity ?? 0) || 0));
    const morphObligatoryCount = obligatory.filter((o) => morphologyTypes.has(o.type)).length;
    return {
      session_id: sessionId,
      turn_number: turnNumber,
      obligatory,
      used,
      naturalness,
      comprehension,
      tunit_length: Math.max(1, Math.round(Number(raw?.tunit_length ?? 1) || 1)),
      had_subordination: Boolean(raw?.had_subordination),
      lexical_rarity: Math.max(modelRarity, assistantDifficulty.lexicalRarity),
      self_correction: Boolean(raw?.self_correction),
      morphology_errors: Math.min(morphologyErrors, morphObligatoryCount),
    };
  }

  private async recordDifficultyWeightedEvidence(annotation: TurnAnnotationInput, input: PostTurnProcessInput): Promise<void> {
    const assistantChallenge = analyzeTextDifficulty(input.assistantText, this.deps.lang);
    const score = outcomeScore(annotation.comprehension);
    const outcome = score >= 0.8 ? "success" : score >= 0.3 ? "partial" : "fail";
    const rareWords = assistantChallenge.rareTokens.map((t) => t.token).join(", ");
    await this.deps.competency.insertProficiencyEvidence({
      skill: "reception",
      dimension: "lexical",
      challenge_band: assistantChallenge.highestBand,
      outcome,
      confidence: assistantChallenge.tokensConsidered > 0 ? Math.max(0.35, Math.min(0.9, assistantChallenge.coverage || 0.5)) : 0.35,
      weight: 1 + assistantChallenge.lexicalRarity,
      evidence_text: `Comprehension=${annotation.comprehension}; assistant lexical band=${assistantChallenge.highestBand}; rarity=${assistantChallenge.lexicalRarity.toFixed(2)}${rareWords ? `; rare tokens: ${rareWords}` : ""}.`,
      challenge_json: JSON.stringify(assistantChallenge),
    });

    const learnerProduction = analyzeTextDifficulty(input.userMessage, this.deps.lang);
    if (learnerProduction.tokensConsidered > 0) {
      await this.deps.competency.insertProficiencyEvidence({
        skill: "production",
        dimension: "lexical",
        challenge_band: learnerProduction.highestBand,
        outcome: annotation.naturalness == null || annotation.naturalness >= 0.75 ? "success" : annotation.naturalness >= 0.45 ? "partial" : "fail",
        confidence: Math.max(0.35, Math.min(0.85, learnerProduction.coverage || 0.5)),
        weight: 0.75 + learnerProduction.lexicalRarity,
        evidence_text: `Learner produced lexical band=${learnerProduction.highestBand}; rarity=${learnerProduction.lexicalRarity.toFixed(2)}; naturalness=${annotation.naturalness ?? "unknown"}.`,
        challenge_json: JSON.stringify(learnerProduction),
      });
    }
  }

  private clean(value: unknown): string {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  private isTransientEvaluatorError(err: unknown): boolean {
    const anyErr = err as { message?: unknown; name?: unknown; code?: unknown };
    const message = this.clean(anyErr?.message).toLowerCase();
    const name = this.clean(anyErr?.name).toLowerCase();
    const code = this.clean(anyErr?.code).toLowerCase();
    return message.includes("empty_json_response")
      || message.includes("unexpected end of json")
      || message.includes("aborted due to timeout")
      || name.includes("timeouterror")
      || code === "23";
  }

  private validCategory(value: unknown): string {
    const cat = this.clean(value).toLowerCase();
    return this.deps.lang.errorCategories.includes(cat) ? cat : "other";
  }

  private grade(value: unknown): number {
    return Math.max(1, Math.min(3, Math.round(Number(value ?? 1) || 1)));
  }

  private nonNegativeInt(value: unknown): number {
    return Math.max(0, Math.round(Number(value ?? 0) || 0));
  }

  private bool(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true" || value === "yes";
  }
}
