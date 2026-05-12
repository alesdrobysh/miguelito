import { BuddyDb } from "../db.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
  nativeLanguage: string;
}

function vocabAdd(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_add",
    description:
      "Silently capture a Spanish vocabulary item the user just used or asked about. Idempotent: a duplicate word is a no-op. Call this freely during conversation; do not announce it to the user.",
    parameters: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description: "Canonical Spanish form: lowercase, infinitive for verbs.",
        },
        translation: {
          type: "string",
          description: `Translation in the user's native language (${ctx.nativeLanguage}). Never use English unless that is the native language.`,
        },
        context: {
          type: "string",
          description: "Brief snippet of the message that introduced the word.",
        },
      },
      required: ["word"],
    },
    execute: async (args: Record<string, string>) => {
      const word = (args.word ?? "").trim().toLowerCase();
      if (!word) {
        return { success: false, output: "", error: "empty_word" };
      }
      const translation = (args.translation ?? "").trim();
      const context = (args.context ?? "").trim();
      const id = await ctx.db.addVocab(word, translation, context);
      if (id === null) {
        return { added: false, reason: "already_exists", word };
      }
      return { added: true, id, word };
    },
  };
}

function vocabList(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_list",
    description:
      "Read back the user's vocabulary from the database. Bucket is one of: all, new, learning, review, mastered.",
    parameters: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          enum: ["all", "new", "learning", "review", "mastered"],
          description: "Vocabulary bucket to filter by.",
        },
        limit: {
          type: "string",
          description: "Max items to return (string-encoded integer, e.g. '50').",
        },
      },
      required: ["bucket"],
    },
    execute: async (args: Record<string, string>) => {
      const bucket = (args.bucket ?? "all").toLowerCase();
      const limit = parseInt(args.limit ?? "50", 10) || 50;
      const items = await ctx.db.listVocab(bucket, limit);
      const out = items.map((r) => ({
        id: r.id,
        word: r.word,
        translation: r.translation,
        context: r.context_first_seen,
        status: r.status,
        repetitions: r.repetitions,
        interval_days: r.interval_days,
        next_review_at: r.next_review_at,
        first_seen_at: r.first_seen_at,
      }));
      return { ok: true, bucket, count: out.length, items: out };
    },
  };
}

function vocabScore(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_score",
    description:
      "Record the result of an SR review (SM-2). Quality: 5=perfect, 4=correct with hesitation, 3=correct with effort, 2=wrong but familiar, 1=barely recognised, 0=blank.",
    parameters: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description: "The exact Spanish word as stored.",
        },
        quality: {
          type: "string",
          description: "Integer 0..5 as a string (e.g. '4').",
        },
      },
      required: ["word", "quality"],
    },
    execute: async (args: Record<string, string>) => {
      const word = (args.word ?? "").trim().toLowerCase();
      const quality = Math.max(0, Math.min(5, parseInt(args.quality ?? "0", 10) || 0));
      try {
        const result = await ctx.db.scoreVocab(word, quality);
        return {
          ok: true,
          word,
          quality,
          repetitions: result.repetitions,
          interval_days: result.interval_days,
          ease_factor: result.ease_factor,
          next_review_at: result.next_review_at,
          status: result.status,
        };
      } catch {
        return { success: false, output: "", error: { error: "not_found", word } };
      }
    },
  };
}

function vocabExport(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_export",
    description:
      "Export vocabulary as CSV or Markdown for external use (e.g. Anki import). Format is 'csv' (default) or 'markdown'.",
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["csv", "markdown"],
          description: "Export format. Default: csv.",
        },
      },
    },
    execute: async (args: Record<string, string>) => {
      const format = args.format ?? "csv";
      const result = await ctx.db.exportVocab(format);
      return { ok: true, format, count: result.count, data: result.data };
    },
  };
}

export function createVocabTools(ctx: ToolContext) {
  return [
    vocabAdd(ctx),
    vocabList(ctx),
    vocabScore(ctx),
    vocabExport(ctx),
  ];
}
