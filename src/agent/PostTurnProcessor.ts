import type { ChatMessage } from "../llm.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { CompetencyRepository, ErrorRepository, LearningRepository, SessionRepository, VocabRepository } from "../repositories/interfaces.js";
import type { LearningItemInput, TurnAnnotationInput, VocabReviewAttempt, VocabReviewMode } from "../domain/types.js";
import { analyzeTextDifficulty, outcomeScore } from "../domain/frequency.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: "postturn" });

export interface PostTurnProcessorDeps {
  provider: LLMProvider;
  vocab: VocabRepository;
  errors: ErrorRepository;
  competency: CompetencyRepository;
  session: SessionRepository;
  learning?: LearningRepository;
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

interface EvaluatedReview {
  attempt_id?: number | string;
  word?: string;
  mode?: VocabReviewMode;
  user_response?: string;
  target_used?: boolean | string | number;
  accepted_variant?: string;
  hint_level?: number | string;
  grade?: number | string;
  note?: string;
}

interface PostTurnEvaluation {
  annotation?: Partial<TurnAnnotationInput>;
  mode?: string;
  errors?: EvaluatedError[];
  vocabulary?: EvaluatedVocab[];
  learning_items?: EvaluatedLearningItem[];
  reviews?: EvaluatedReview[];
}

export interface PostTurnProcessResult {
  ok: boolean;
  errorsLogged: number;
  vocabAdded: number;
  vocabCandidatesAdded: number;
  learningItemsAdded: number;
  reviewsCompleted: number;
  annotationInserted: boolean;
}

const VALID_COMPREHENSION = new Set(["smooth", "asked_clarify", "requested_simpler"]);
const VALID_MODES = new Set(["REACT", "DIG", "OFFER", "TEACH", "PLAY"]);

export class PostTurnProcessor {
  constructor(private deps: PostTurnProcessorDeps) {}

  async process(input: PostTurnProcessInput): Promise<PostTurnProcessResult> {
    const evaluation = await this.evaluate(input);
    return this.apply(evaluation, input);
  }

  private async evaluate(input: PostTurnProcessInput): Promise<PostTurnEvaluation> {
    const activeAttempts = await this.deps.vocab.listActiveVocabReviewAttempts(5);
    const systemPrompt = [
      `You are a deterministic evaluator for a ${this.deps.lang.name} tutoring chatbot.`,
      "Return only JSON. Do not write learner-facing text.",
      "Extract post-turn learning events from the latest user message and assistant reply.",
      "This evaluator, not the chat model, owns annotation, error/vocabulary extraction, and review scoring.",
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
        vocabulary: [{
          word: "candidate collocational chunk",
          context: "L2 context",
          anchor: "optional lemma",
          reason: "why it is useful",
          priority: "0.9=correction/explicitly asked, 0.7=useful conversational, 0.5=niche/too advanced",
          topic_tags: ["optional topic"],
          acceptable_variants: ["optional variant"],
          elicitation_cues: ["optional production cue"]
        }],
        learning_items: [{ type: "grammar_point|correction|phrase|word|collocation|idiom|register_note|pronunciation", title: "por vs para", prompt_l2: "optional L2 prompt", explanation_l1: "short explanation", source_type: "user_question|conversation|correction", priority: "0.9=correction/explicitly asked, 0.7=useful, 0.5=niche", practice_modes: ["short_drill"] }],
        reviews: [{ attempt_id: 123, word: "exact chunk_l2 from vocabulary", mode: "productive|receptive", user_response: "learner answer", target_used: true, accepted_variant: "actual form", hint_level: 0, grade: 3, note: "why" }],
      }),
      "Use empty arrays when there is nothing to extract. Grade reviews 1..3 only.",
      "Add a review entry whenever the assistant created a vocabulary practice opportunity (e.g. asked the learner to produce or recognize a chunk) and the learner responded. Use word=exact chunk_l2, mode=productive if learner was asked to produce it, receptive if assistant used it for comprehension.",
      "If Active review attempts are provided and the latest learner message answers one of them, include that exact attempt_id in the review entry so the pending attempt is completed instead of creating a new attempt.",
    ].join("\n");

    const recent = input.chatHistory.slice(-8).map((m) => `${m.role}: ${m.content}`).join("\n");
    const userPrompt = [
      "Recent history:",
      recent || "(none)",
      "Active review attempts:",
      this.formatActiveAttempts(activeAttempts),
      "Latest learner message:",
      input.userMessage,
      "Assistant reply:",
      input.assistantText,
    ].join("\n\n");

    try {
      return await this.deps.provider.completeJson<PostTurnEvaluation>(systemPrompt, userPrompt, {
        temperature: 0,
        maxTokens: 1200,
        structured: true,
      });
    } catch (err) {
      log.warn({ err }, "post-turn evaluation failed");
      return {};
    }
  }

  private async apply(evaluation: PostTurnEvaluation, _input: PostTurnProcessInput): Promise<PostTurnProcessResult> {
    let errorsLogged = 0;
    let vocabAdded = 0;
    let vocabCandidatesAdded = 0;
    let learningItemsAdded = 0;
    let reviewsCompleted = 0;
    let annotationInserted = false;

    const morphologyTypes = new Set(this.deps.lang.morphologyCategories);
    const morphologyErrors = (evaluation.errors ?? []).filter((e) => {
      const cat = this.clean(e.category).toLowerCase();
      return morphologyTypes.has(cat);
    }).length;
    const annotation = this.normalizeAnnotation(evaluation.annotation, _input, morphologyErrors);
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
      const id = await this.deps.vocab.addVocabCandidate({
        chunk_l2: word,
        capture_context_l2: this.clean(item.context),
        anchor: this.clean(item.anchor).toLowerCase() || undefined,
        meaning_l1: this.clean(item.meaning) || undefined,
        source_type: evaluation.errors?.length ? "correction" : "conversation",
        evidence_snippet: this.clean(item.context) || _input.userMessage,
        proposed_by: "post_turn_evaluator",
        priority: Math.max(0, Math.min(1, Number(item.priority ?? 0.6) || 0.6)),
        topic_tags: Array.isArray(item.topic_tags) ? item.topic_tags.map((x) => String(x)).filter(Boolean) : [],
        acceptable_variants: Array.isArray(item.acceptable_variants) ? item.acceptable_variants.map((x) => String(x)).filter(Boolean) : [],
        elicitation_cues: Array.isArray(item.elicitation_cues) ? item.elicitation_cues.map((x) => String(x)).filter(Boolean) : [],
        promotion_reason: this.clean(item.reason) || undefined,
      });
      if (id !== null) vocabCandidatesAdded++;
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

    for (const item of evaluation.learning_items ?? []) {
      const input = this.learningItemInput(item, _input);
      if (!input) continue;
      const learningId = await this.learningRepo().addLearningItem(input);
      if (learningId !== null) learningItemsAdded++;
    }

    const promoted = await this.deps.vocab.promoteVocabCandidates({ maxPromotions: 2, minPriority: 0.75, maxActiveLearningItems: 40 });
    vocabAdded += promoted.length;

    const activeAttempts = await this.deps.vocab.listActiveVocabReviewAttempts(10);
    for (const item of evaluation.reviews ?? []) {
      const grade = this.grade(item.grade);
      const attemptId = this.resolveAttemptId(item, activeAttempts);
      try {
        if (attemptId > 0) {
          await this.deps.vocab.finishVocabReviewAttempt({
            attempt_id: attemptId,
            user_response: this.clean(item.user_response),
            target_used: this.bool(item.target_used),
            accepted_variant: this.clean(item.accepted_variant),
            hint_level: this.nonNegativeInt(item.hint_level),
            grade,
            note: this.clean(item.note),
          });
          reviewsCompleted++;
        } else if (this.clean(item.word)) {
          const attempt = await this.deps.vocab.startVocabReviewAttempt({
            word: this.clean(item.word),
            mode: item.mode === "receptive" ? "receptive" : "productive",
            strategy: "post_turn_evaluator",
            prompt_text: _input.assistantText,
            hint_level: this.nonNegativeInt(item.hint_level),
          });
          await this.deps.vocab.finishVocabReviewAttempt({
            attempt_id: attempt.id,
            user_response: this.clean(item.user_response) || _input.userMessage,
            target_used: this.bool(item.target_used),
            accepted_variant: this.clean(item.accepted_variant),
            hint_level: this.nonNegativeInt(item.hint_level),
            grade,
            note: this.clean(item.note),
          });
          reviewsCompleted++;
        }
      } catch (err) {
        log.warn({ err, review: item }, "review application failed");
      }
    }

    return { ok: true, errorsLogged, vocabAdded, vocabCandidatesAdded, learningItemsAdded, reviewsCompleted, annotationInserted };
  }

  private learningRepo(): LearningRepository {
    return this.deps.learning ?? (this.deps.vocab as unknown as LearningRepository);
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

  private normalizeAnnotation(raw: Partial<TurnAnnotationInput> | undefined, input: PostTurnProcessInput, morphologyErrors: number): TurnAnnotationInput {
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
      obligatory,
      used,
      naturalness,
      comprehension,
      tunit_length: Math.max(1, Math.round(Number(raw?.tunit_length ?? 1) || 1)),
      had_subordination: Boolean(raw?.had_subordination),
      lexical_rarity: Math.max(modelRarity, assistantDifficulty.lexicalDifficulty),
      self_correction: Boolean(raw?.self_correction),
      morphology_errors: Math.min(morphologyErrors, morphObligatoryCount),
    };
  }

  private formatActiveAttempts(attempts: VocabReviewAttempt[]): string {
    if (attempts.length === 0) return "(none)";
    return attempts.map((a) => JSON.stringify({
      attempt_id: a.id,
      word: a.word,
      mode: a.mode,
      strategy: a.strategy,
      prompt_text: a.prompt_text,
      hint_level: a.hint_level,
      created_at: a.created_at,
    })).join("\n");
  }

  private resolveAttemptId(item: EvaluatedReview, activeAttempts: VocabReviewAttempt[]): number {
    const explicit = Number(item.attempt_id ?? 0);
    if (explicit > 0) return explicit;
    const word = this.clean(item.word).toLowerCase();
    const mode = item.mode === "receptive" ? "receptive" : item.mode === "productive" ? "productive" : undefined;
    const match = activeAttempts.find((a) =>
      a.word.trim().toLowerCase() === word && (!mode || a.mode === mode)
    );
    return match?.id ?? 0;
  }

  private async recordDifficultyWeightedEvidence(annotation: TurnAnnotationInput, input: PostTurnProcessInput): Promise<void> {
    const assistantChallenge = analyzeTextDifficulty(input.assistantText, this.deps.lang);
    const score = outcomeScore(annotation.comprehension);
    const outcome = score >= 0.8 ? "success" : score >= 0.3 ? "partial" : "fail";
    const rareWords = assistantChallenge.rareTokens.map((t) => t.token).join(", ");
    await this.deps.competency.insertProficiencyEvidence({
      skill: "reception",
      dimension: "lexical",
      level: assistantChallenge.estimatedLevel,
      outcome,
      confidence: assistantChallenge.tokensConsidered > 0 ? Math.max(0.35, Math.min(0.9, assistantChallenge.coverage || 0.5)) : 0.35,
      weight: 1 + assistantChallenge.lexicalDifficulty,
      evidence_text: `Comprehension=${annotation.comprehension}; assistant lexical level=${assistantChallenge.estimatedLevel}${rareWords ? `; hard tokens: ${rareWords}` : ""}.`,
      challenge_json: JSON.stringify(assistantChallenge),
    });

    const learnerProduction = analyzeTextDifficulty(input.userMessage, this.deps.lang);
    if (learnerProduction.tokensConsidered > 0) {
      await this.deps.competency.insertProficiencyEvidence({
        skill: "production",
        dimension: "lexical",
        level: learnerProduction.estimatedLevel,
        outcome: annotation.naturalness == null || annotation.naturalness >= 0.75 ? "success" : annotation.naturalness >= 0.45 ? "partial" : "fail",
        confidence: Math.max(0.35, Math.min(0.85, learnerProduction.coverage || 0.5)),
        weight: 0.75 + learnerProduction.lexicalDifficulty,
        evidence_text: `Learner produced ${learnerProduction.estimatedLevel} lexical material; naturalness=${annotation.naturalness ?? "unknown"}.`,
        challenge_json: JSON.stringify(learnerProduction),
      });
    }
  }

  private clean(value: unknown): string {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
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
