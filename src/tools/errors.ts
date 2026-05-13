import { VALID_CATEGORIES } from "../domain/types.js";
import type { ToolContext } from "./index.js";

function errorLog(ctx: ToolContext) {
  return {
    name: "miguelito_error_log",
    description:
      "Record a Spanish-mistake correction the user just received. Categories: gender, verb_conjugation, preposition, spelling, word_choice, agreement, ser_estar, por_para, other.",
    parameters: {
      type: "object",
      properties: {
        user_text: {
          type: "string",
          description: "What the user wrote (the wrong form).",
        },
        correct: {
          type: "string",
          description: "The corrected Spanish form.",
        },
        category: {
          type: "string",
          description: "Error category from the fixed list.",
        },
        note: {
          type: "string",
          description: "Short explanation in user's native language.",
        },
      },
      required: ["user_text", "correct", "category"],
    },
    execute: async (args: Record<string, string>) => {
      const userText = (args.user_text ?? "").trim();
      const correct = (args.correct ?? "").trim();
      let category = (args.category ?? "other").trim().toLowerCase();
      const note = (args.note ?? "").trim();

      if (!VALID_CATEGORIES.has(category)) category = "other";

      const id = await ctx.errors.logError(userText, correct, category, note);
      return { ok: true, id, category };
    },
  };
}

export function createErrorTools(ctx: ToolContext) {
  return [errorLog(ctx)];
}
