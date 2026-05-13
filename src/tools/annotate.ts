import { BuddyDb, ErrorCategory, ObligatoryContext } from "../db.js";

export interface ToolContext {
  db: BuddyDb;
}

const VALID_CATEGORIES = new Set<string>([
  "gender", "verb_conjugation", "preposition", "spelling",
  "word_choice", "agreement", "ser_estar", "por_para", "other",
]);

function turnAnnotate(ctx: ToolContext) {
  return {
    name: "miguelito_turn_annotate",
    description:
      "Record a per-turn production annotation for the learner's utterance. " +
      "Call this silently every turn after composing your reply. " +
      "obligatory: morphological/grammatical contexts the learner was required to handle this turn. " +
      "used: specific constructions the learner actually produced (for avoidance tracking). " +
      "naturalness: 0.0–1.0 idomaticity score (1=fully native, 0=clear calque/unnatural). " +
      "comprehension: how the learner responded to YOUR previous turn (smooth=followed fine, asked_clarify=asked what you meant, requested_simpler=asked you to simplify).",
    parameters: {
      type: "object",
      properties: {
        obligatory: {
          type: "array",
          description: "Morphological/grammatical contexts required this turn (e.g. verb conjugation, noun-adjective agreement).",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                description: "Category: gender, verb_conjugation, preposition, spelling, word_choice, agreement, ser_estar, por_para, other",
              },
            },
            required: ["type"],
          },
        },
        used: {
          type: "array",
          description: "Constructions the learner actually produced this turn (e.g. 'subjunctive after que', 'reflexive verb').",
          items: { type: "string" },
        },
        naturalness: {
          type: "number",
          description: "Idiomaticity score 0.0–1.0. Omit if not enough production to judge.",
        },
        comprehension: {
          type: "string",
          description: "How the learner responded to your previous turn: smooth | asked_clarify | requested_simpler",
        },
        tunit_length: {
          type: "number",
          description: "Estimated number of distinct T-units (independent clauses) in the learner's utterance.",
        },
        had_subordination: {
          type: "boolean",
          description: "True if the learner used at least one subordinate clause.",
        },
      },
      required: ["obligatory", "used", "comprehension"],
    },
    // agent.ts serialises all non-string values with JSON.stringify, so arrays
    // arrive as JSON strings — parse them explicitly.
    execute: async (args: Record<string, string>) => {
      let rawObligatory: Array<{ type?: string }> = [];
      try {
        const parsed = JSON.parse(args.obligatory ?? "[]");
        if (Array.isArray(parsed)) rawObligatory = parsed;
      } catch {}
      const obligatory: ObligatoryContext[] = rawObligatory
        .filter((o) => o?.type && VALID_CATEGORIES.has(o.type))
        .map((o) => ({ type: (VALID_CATEGORIES.has(o.type!) ? o.type! : "other") as ErrorCategory }));

      let used: string[] = [];
      try {
        const parsed = JSON.parse(args.used ?? "[]");
        if (Array.isArray(parsed)) used = parsed.map(String);
      } catch {}

      const rawNaturalness = parseFloat(args.naturalness ?? "");
      const naturalness = isNaN(rawNaturalness) ? null : Math.max(0, Math.min(1, rawNaturalness));

      const rawComprehension = (args.comprehension ?? "smooth").trim();
      const validComprehension = new Set(["smooth", "asked_clarify", "requested_simpler"]);
      const comprehension = validComprehension.has(rawComprehension)
        ? (rawComprehension as "smooth" | "asked_clarify" | "requested_simpler")
        : "smooth";

      const tunit_length = Math.max(1, Math.round(parseFloat(args.tunit_length ?? "1") || 1));
      const had_subordination = args.had_subordination === "true" || args.had_subordination === "1";

      await ctx.db.insertTurnAnnotation({
        obligatory,
        used: used.map(String),
        naturalness,
        comprehension,
        tunit_length,
        had_subordination,
      });

      return {};
    },
  };
}

export function createAnnotateTools(ctx: ToolContext) {
  return [turnAnnotate(ctx)];
}
