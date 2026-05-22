import type { ChatMessage } from "../llm.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { LLMProvider } from "../providers/interfaces.js";
import type { CompetencyRepository, ErrorRepository, SessionRepository, VocabRepository } from "../repositories/interfaces.js";
import type { TurnAnnotationInput, VocabReviewMode } from "../domain/types.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: "postturn" });

export interface PostTurnProcessorDeps {
  provider: LLMProvider;
  vocab: VocabRepository;
  errors: ErrorRepository;
  competency: CompetencyRepository;
  session: SessionRepository;
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
  reviews?: EvaluatedReview[];
}

export interface PostTurnProcessResult {
  ok: boolean;
  errorsLogged: number;
  vocabAdded: number;
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
          tunit_length: 1,
          had_subordination: false,
        },
        mode: "REACT|DIG|OFFER|TEACH|PLAY",
        errors: [{ user_text: "wrong learner text", correct: "correct form", category: "category", note: "short note" }],
        vocabulary: [{ word: "collocational chunk", context: "L2 context", anchor: "optional lemma" }],
        reviews: [{ attempt_id: 1, user_response: "learner answer", target_used: true, accepted_variant: "actual form", hint_level: 0, grade: 3, note: "why" }],
      }),
      "Use empty arrays when there is nothing to extract. Grade reviews 1..3 only.",
    ].join("\n");

    const recent = input.chatHistory.slice(-8).map((m) => `${m.role}: ${m.content}`).join("\n");
    const userPrompt = [
      "Recent history:",
      recent || "(none)",
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
    let reviewsCompleted = 0;
    let annotationInserted = false;

    const annotation = this.normalizeAnnotation(evaluation.annotation);
    await this.deps.competency.insertTurnAnnotation(annotation);
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
      const id = await this.deps.vocab.addVocab(word, this.clean(item.context), this.clean(item.anchor).toLowerCase() || undefined);
      if (id !== null) vocabAdded++;
    }

    for (const item of evaluation.reviews ?? []) {
      const grade = this.grade(item.grade);
      const attemptId = Number(item.attempt_id ?? 0);
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

    return { ok: true, errorsLogged, vocabAdded, reviewsCompleted, annotationInserted };
  }

  private normalizeAnnotation(raw?: Partial<TurnAnnotationInput>): TurnAnnotationInput {
    const validCategories = new Set(this.deps.lang.errorCategories);
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
    return {
      obligatory,
      used,
      naturalness,
      comprehension,
      tunit_length: Math.max(1, Math.round(Number(raw?.tunit_length ?? 1) || 1)),
      had_subordination: Boolean(raw?.had_subordination),
      lexical_rarity: Math.max(0, Math.min(1, Number(raw?.lexical_rarity ?? 0) || 0)),
      self_correction: Boolean(raw?.self_correction),
    };
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
