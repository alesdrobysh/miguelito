import { statusOf } from "../domain/fsrs.js";
import type { ToolContext } from "./index.js";

function vocabAdd(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_add",
    description:
      "Add a chunk to the vocabulary list for future spaced-repetition practice. " +
      "Call ONLY when: (1) the learner made an error with this chunk, OR (2) the learner explicitly asked about its meaning (e.g. 'what does X mean?'). " +
      "Do NOT add chunks the learner produced correctly on their own — correct production means they already know it. " +
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
      const id = await ctx.vocab.addVocab(chunk, context, anchor);
      if (id === null) return { added: false, reason: "already_exists", word: chunk };
      return { added: true, id, word: chunk, anchor: anchor ?? null };
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
        const result = await ctx.vocab.scoreVocab(chunk, grade, mode);
        return { ok: true, word: chunk, grade, mode, stability: result.stability, reps: result.reps, due: result.due, status: result.status };
      } catch {
        return { ok: false, error: "not_found", word: chunk };
      }
    },
  };
}


function vocabAttemptStart(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_attempt_start",
    description:
      "Record that you created a concrete vocabulary review opportunity. " +
      "Use mode='productive' when you create a communicative need for the learner to produce a due chunk; " +
      "use mode='receptive' when you intentionally integrate a chunk in your own message for comprehension practice. " +
      "Call before/while sending the prompt that creates the opportunity.",
    parameters: {
      type: "object",
      properties: {
        word: { type: "string", description: "Exact chunk as stored (chunk_l2)." },
        mode: { type: "string", enum: ["productive", "receptive"], description: "productive | receptive" },
        strategy: { type: "string", description: "Elicitation strategy, e.g. personal_question, roleplay, reformulation, cloze, semantic_hint." },
        prompt_text: { type: "string", description: "The visible tutor prompt or message that created the review opportunity." },
        hint_level: { type: "string", description: "0=no hint/natural task, 1=task prompt, 2=semantic hint, 3=cloze/first-letter, 4=full model." },
      },
      required: ["word", "mode", "strategy", "prompt_text"],
    },
    execute: async (args: Record<string, string>) => {
      const attempt = await ctx.vocab.startVocabReviewAttempt({
        word: (args.word ?? "").trim().toLowerCase(),
        mode: args.mode === "receptive" ? "receptive" : "productive",
        strategy: (args.strategy ?? "").trim(),
        prompt_text: (args.prompt_text ?? "").trim(),
        hint_level: parseInt(args.hint_level ?? "0", 10) || 0,
      });
      return { ok: true, attempt_id: attempt.id, word: attempt.word, mode: attempt.mode, status: attempt.status };
    },
  };
}

function vocabAttemptFinish(ctx: ToolContext) {
  return {
    name: "miguelito_vocab_attempt_finish",
    description:
      "Complete a vocabulary review attempt after the learner responds. " +
      "Grades 1-3 map to FSRS: 1=Again/failed or only full-model repetition, 2=Good/elicited or assisted correct production, 3=Easy/spontaneous fluent use. " +
      "This also updates the chunk's productive or receptive FSRS schedule according to the attempt mode.",
    parameters: {
      type: "object",
      properties: {
        attempt_id: { type: "string", description: "ID returned by miguelito_vocab_attempt_start." },
        user_response: { type: "string", description: "Learner response being graded." },
        target_used: { type: "string", description: "true if the learner used the target or an accepted variant." },
        accepted_variant: { type: "string", description: "Actual form the learner used, if any." },
        hint_level: { type: "string", description: "Minimum hint level needed for success, 0-4." },
        grade: { type: "string", description: "Integer 1..3." },
        note: { type: "string", description: "Brief reason for grade." },
      },
      required: ["attempt_id", "target_used", "grade"],
    },
    execute: async (args: Record<string, string>) => {
      const attempt = await ctx.vocab.finishVocabReviewAttempt({
        attempt_id: parseInt(args.attempt_id ?? "0", 10),
        user_response: (args.user_response ?? "").trim(),
        target_used: args.target_used === "true" || args.target_used === "1" || args.target_used === "yes",
        accepted_variant: (args.accepted_variant ?? "").trim(),
        hint_level: parseInt(args.hint_level ?? "0", 10) || 0,
        grade: parseInt(args.grade ?? "1", 10) || 1,
        note: (args.note ?? "").trim(),
      });
      return { ok: true, attempt_id: attempt.id, word: attempt.word, mode: attempt.mode, grade: attempt.grade, status: attempt.status };
    },
  };
}

export function createVocabTools(ctx: ToolContext) {
  return [vocabAdd(ctx), vocabScore(ctx), vocabAttemptStart(ctx), vocabAttemptFinish(ctx)];
}
