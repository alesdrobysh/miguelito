import { estimateProficiency, getCompetencyVector, selectFocusAxis, formatVectorForDisplay } from "../domain/competency.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { ToolContext } from "./index.js";

function progressSummary(ctx: ToolContext, lang: LanguageConfig) {
  return {
    name: "miguelito_progress_summary",
    description: "Summarize learning items, due-now items, recent additions, recent errors, error category histogram, and live competency vector. Call this when the user sends /progreso.",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      const activeItems = await ctx.learning.listLearningItems("active", 1000);
      const dueItems = await ctx.learning.listDueLearningItems(1000);
      const hygiene = await ctx.learning.getLearningHygieneSnapshot();
      const pressureRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const rustyExamples = dueItems
        .slice()
        .sort((a, b) =>
          (pressureRank[String(b.reactivation_pressure)] ?? 0) - (pressureRank[String(a.reactivation_pressure)] ?? 0)
          || (b.priority - a.priority)
          || (a.id - b.id),
        )
        .slice(0, 5)
        .map((i) => i.title);
      const errors = await ctx.errors.listErrors("all", 1000);
      const errorCategories = errors.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + 1;
        return acc;
      }, {});

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
          proficiency: estimateProficiency(cv),
        };
      } catch {}

      return {
        ok: true,
        learning_items: {
          active: activeItems.length,
          due_now: dueItems.length,
          new: activeItems.filter((i) => i.stability === "new").length,
          practiced: activeItems.filter((i) => i.evidence_count > 0).length,
          stable: activeItems.filter((i) => i.stability === "stable" || i.status === "stable").length,
        },
        hygiene: {
          backlog_status: hygiene.backlog_status,
          active_without_evidence: hygiene.active_without_evidence,
          candidate_without_evidence: hygiene.candidate_without_evidence,
          stale_new_items: hygiene.stale_new_items,
          due_high_pressure: hygiene.due_high_pressure,
          rusty_examples: rustyExamples,
          reintroduced_without_production: hygiene.reintroduced_without_production,
          suspicious_items: hygiene.suspicious_items,
        },
        recent_items: activeItems.slice(0, 5).map((i) => i.title),
        error_categories: errorCategories,
        competency,
      };
    },
  };
}

export function createProgressTools(ctx: ToolContext, lang: LanguageConfig) {
  return [progressSummary(ctx, lang)];
}
