import { BuddyDb } from "../db.js";
import { statusOf } from "../fsrs.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function vocabAdd(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_add",
    description:
      "Silently capture a Spanish chunk the user just used or asked about. " +
      "Store the collocational form, not the bare word. Idempotent. Do not announce it.",
    parameters: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description:
            "Full collocational chunk in Spanish, lowercase. " +
            "Prefer the construction over the bare word: 'echar de menos' not 'echar', " +
            "'me cuesta + [inf]' not 'costar'. Slot markers: [inf], [noun], [adj], [clause].",
        },
        context: {
          type: "string",
          description:
            "Exact L2 sentence or phrase from the conversation where the chunk appeared. " +
            "e.g. 'Te echo de menos, amigo'. Keep it in Spanish — no translation.",
        },
        anchor: {
          type: "string",
          description:
            "Base lemma for lookup/grouping, e.g. 'echar' for 'echar de menos'. " +
            "Omit for bare-word entries.",
        },
      },
      required: ["word"],
    },
    execute: async (args: Record<string, string>) => {
      const chunk = (args.word ?? "").trim().toLowerCase();
      if (!chunk) return { success: false, error: "empty_chunk" };
      const context = (args.context ?? "").trim();
      const anchor = (args.anchor ?? "").trim().toLowerCase() || undefined;
      const id = await ctx.db.addVocab(chunk, context, anchor);
      if (id === null) return { added: false, reason: "already_exists", word: chunk };
      return { added: true, id, word: chunk, anchor: anchor ?? null };
    },
  };
}

function vocabList(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_list",
    description:
      "Read the user's chunk list from the database. Bucket: all, new, learning, review, mastered.",
    parameters: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          enum: ["all", "new", "learning", "review", "mastered"],
          description: "Filter by learning status.",
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
        word: r.chunk_l2,
        anchor: r.anchor,
        context: r.capture_context_l2,
        status: statusOf(r.pro_reps, r.pro_stability),
        pro_stability: r.pro_stability,
        pro_reps: r.pro_reps,
        pro_due: r.pro_due,
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
      "Record an FSRS review for a chunk. " +
      "Grade 1-3: 1=Again (wrong/error), 2=Good (correct, independent), 3=Easy (spontaneous, fluent). " +
      "mode='productive' (default) when the user wrote/produced the chunk. " +
      "mode='receptive' when the bot used the chunk and the user engaged with its meaning.",
    parameters: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description: "Exact chunk as stored (chunk_l2).",
        },
        grade: {
          type: "string",
          description: "Integer 1..3 as a string. 1=Again, 2=Good, 3=Easy.",
        },
        mode: {
          type: "string",
          enum: ["productive", "receptive"],
          description: "productive = user produced it; receptive = user understood it passively.",
        },
      },
      required: ["word", "grade"],
    },
    execute: async (args: Record<string, string>) => {
      const chunk = (args.word ?? "").trim().toLowerCase();
      const grade = Math.max(1, Math.min(3, parseInt(args.grade ?? "2", 10) || 2));
      const mode = args.mode === "receptive" ? "receptive" : "productive";
      try {
        const result = await ctx.db.scoreVocab(chunk, grade, mode);
        return { ok: true, word: chunk, grade, mode, stability: result.stability, reps: result.reps, due: result.due, status: result.status };
      } catch {
        return { ok: false, error: "not_found", word: chunk };
      }
    },
  };
}

function vocabExport(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_export",
    description: "Export chunk list as CSV or Markdown.",
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
  return [vocabAdd(ctx), vocabList(ctx), vocabScore(ctx), vocabExport(ctx)];
}
