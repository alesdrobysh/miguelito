import { BuddyDb } from "../db.js";
import { getCompetencyVector, selectFocusAxis, formatVectorForDisplay } from "../competency.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function progressSummary(ctx: ToolContext) {
  return {
    name: "miguelito_progress_summary",
    description: "Aggregate counts of vocab buckets, due-now words, recent additions, recent errors, error category histogram, and live competency vector. Call this when the user sends /progreso.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const data = await ctx.db.progressSummary();

      let competency: Record<string, unknown> | null = null;
      try {
        const vec = await getCompetencyVector(ctx.db);
        const focus = selectFocusAxis(vec);
        competency = {
          summary: formatVectorForDisplay(vec),
          focus_axis: focus ?? "none",
          lexicon_active_chunks: vec.lexicon.activeChunks,
          morph_accuracy: Math.round(vec.morphology.rate * 100),
          morph_confidence: vec.morphology.confidence,
          idiom_naturalness: Math.round(vec.idiomaticity.rate * 100),
          idiom_confidence: vec.idiomaticity.confidence,
          syntax_tunit_mean: parseFloat(vec.syntax.meanTunitLength.toFixed(1)),
          syntax_sub_index: Math.round(vec.syntax.subIndex * 100),
          syntax_confidence: vec.syntax.confidence,
          reception: Math.round(vec.reception.level * 100),
          reception_confidence: vec.reception.confidence,
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

export function createProgressTools(ctx: ToolContext) {
  return [progressSummary(ctx)];
}
