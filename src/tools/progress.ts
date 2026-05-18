import { getCompetencyVector, selectFocusAxis, formatVectorForDisplay } from "../domain/competency.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { ToolContext } from "./index.js";

function progressSummary(ctx: ToolContext, lang: LanguageConfig) {
  return {
    name: "miguelito_progress_summary",
    description: "Aggregate counts of vocab buckets, due-now words, recent additions, recent errors, error category histogram, and live competency vector. Call this when the user sends /progreso.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const data = await ctx.vocab.progressSummary();

      let competency: Record<string, unknown> | null = null;
      try {
        const cv = await getCompetencyVector(ctx);
        const focus = selectFocusAxis(cv, lang);
        competency = {
          summary: formatVectorForDisplay(cv),
          focus_axis: focus ?? "none",
          lexicon_active_chunks: cv.lexicon.activeChunks,
          morph_accuracy: Math.round(cv.morphology.rate * 100),
          morph_confidence: cv.morphology.confidence,
          idiom_naturalness: Math.round(cv.idiomaticity.rate * 100),
          idiom_confidence: cv.idiomaticity.confidence,
          syntax_tunit_mean: parseFloat(cv.syntax.meanTunitLength.toFixed(1)),
          syntax_sub_index: Math.round(cv.syntax.subIndex * 100),
          syntax_confidence: cv.syntax.confidence,
          reception: Math.round(cv.reception.level * 100),
          reception_confidence: cv.reception.confidence,
        };
      } catch {}

      return {
        ok: true,
        vocab: {
          total: data.totalCount,
          new: data.newCount,
          learning: data.learningCount,
          review: data.reviewCount,
          mastered: data.masteredCount,
          due_now: data.dueCount,
        },
        recent_words: data.recentWords,
        error_categories: data.errorCategories,
        competency,
      };
    },
  };
}

export function createProgressTools(ctx: ToolContext, lang: LanguageConfig) {
  return [progressSummary(ctx, lang)];
}
