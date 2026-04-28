import { BuddyDb } from "../db.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function progressSummary(ctx: ToolContext) {
  return {
    name: "miguelito_progress_summary",
    description: "Aggregate counts of vocab buckets, due-now words, recent additions, recent errors, and error category histogram. Call this when the user sends /progreso.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const data = ctx.db.progressSummary();
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
      };
    },
  };
}

export function createProgressTools(ctx: ToolContext) {
  return [progressSummary(ctx)];
}
