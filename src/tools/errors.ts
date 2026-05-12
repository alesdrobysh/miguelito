import { BuddyDb } from "../db.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

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

      const validCategories = new Set([
        "gender", "verb_conjugation", "preposition", "spelling",
        "word_choice", "agreement", "ser_estar", "por_para", "other",
      ]);
      if (!validCategories.has(category)) category = "other";

      const id = await ctx.db.logError(userText, correct, category, note);
      return { ok: true, id, category };
    },
  };
}

export function createErrorTools(ctx: ToolContext) {
  return [errorLog(ctx)];
}
