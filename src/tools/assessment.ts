import { BuddyDb } from "../db.js";
import { llmCompleteJson } from "../llm.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function cefrAssess(ctx: ToolContext) {
  return {
    name: "miguelito_cefr_assess",
    description: "Assess the user's CEFR Spanish level from a batch of recent messages. Receives collected messages, evaluates level using a cheap LLM, writes the result to the learner profile database. Updates user_profile.level if confidence > 0.7.",
    parameters: {
      type: "object",
      properties: {
        messages: {
          type: "string",
          description: "Recent Spanish messages from the user to assess, concatenated.",
        },
      },
      required: ["messages"],
    },
    execute: async (args: Record<string, string>) => {
      const messages = (args.messages ?? "").trim();
      if (!messages) return { ok: false, error: "no_messages" };
      if (!ctx.apiKey) return { ok: false, error: "no_api_key" };

      try {
        const assessment = await llmCompleteJson<{
          cefr_level: string;
          confidence: number;
          weak_areas: string[];
          strengths: string[];
        }>(
          ctx.apiKey,
          "You are a CEFR language assessment expert. You assess Spanish learners. Return ONLY JSON.",
          `You are a CEFR language assessment expert. Given the following Spanish messages from a learner, assess their CEFR level (A1, A2, B1, B2, C1, C2).

Consider: vocabulary range, grammatical accuracy, sentence complexity, tense usage, and overall fluency.

Respond with JSON only:
{
  "cefr_level": "B1",
  "confidence": 0.85,
  "justification": "...",
  "weak_areas": ["subjunctive", "por/para"],
  "strengths": ["present tense", "basic vocabulary"]
}

Messages:
${messages}`,
          0.1,
          256,
        );

        const weakJson = JSON.stringify(assessment.weak_areas ?? []);
        const strengthsJson = JSON.stringify(assessment.strengths ?? []);
        const sampleCount = messages.split("\n").length;

        const id = ctx.db.insertAssessment(
          assessment.cefr_level,
          assessment.confidence,
          weakJson,
          "",
          "",
          strengthsJson,
          sampleCount,
        );

        let levelUpdated = false;
        if (assessment.confidence > 0.7) {
          const profile = ctx.db.getProfile();
          if (!profile || profile.level !== assessment.cefr_level) {
            ctx.db.setProfile({ level: assessment.cefr_level });
            levelUpdated = true;
          }
        }

        return {
          ok: true,
          assessment_id: id,
          cefr_level: assessment.cefr_level,
          confidence: assessment.confidence,
          level_updated: levelUpdated,
        };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    },
  };
}

export function createAssessmentTools(ctx: ToolContext) {
  return [cefrAssess(ctx)];
}
