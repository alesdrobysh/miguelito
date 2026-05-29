import type { ToolContext } from "./index.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";

function errorLog(ctx: ToolContext, lang: LanguageConfig) {
  return {
    name: "miguelito_error_log",
    description:
      `Record a ${lang.name}-mistake correction the user just received. Categories: ${lang.errorCategories.join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        user_text: {
          type: "string",
          description: "What the user wrote (the wrong form).",
        },
        correct: {
          type: "string",
          description: "The corrected form.",
        },
        category: {
          type: "string",
          description: "Error category from the fixed list.",
        },
        note: {
          type: "string",
          description: "Short explanation.",
        },
      },
      required: ["user_text", "correct", "category"],
    },
    execute: async (args: Record<string, string>) => {
      const userText = (args.user_text ?? "").trim();
      const correct = (args.correct ?? "").trim();
      let category = (args.category ?? "other").trim().toLowerCase();
      const note = (args.note ?? "").trim();

      if (!new Set(lang.errorCategories).has(category)) category = "other";

      const id = await ctx.errors.logError(userText, correct, category, note);
      return { ok: true, id, category };
    },
  };
}

export function createErrorTools(ctx: ToolContext, lang: LanguageConfig) {
  return [errorLog(ctx, lang)];
}
