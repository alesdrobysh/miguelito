import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { PromptBuilder } from "./PromptBuilder.js";
import { buildConversationPlan } from "./ConversationPlanner.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import type { PromptRepos } from "./PromptBuilder.js";

function repos(interests: string[] = []): PromptRepos {
  const convState = {
    session: {
      id: 1,
      session_id: "s1",
      turn_count: 0,
      last_two_modes: "[]",
      topics_touched: "[]",
      mood_hint: null,
      language: "spanish",
      started_at: "2026-06-19 00:00:00",
      updated_at: "2026-06-19 00:00:00",
    },
    isNew: true,
  } as any;

  return {
    profile: { getProfile: async () => ({ name: "Ales" }), setProfile: async () => [] } as any,
    langProfile: { getProfile: async () => ({ goal: "hablar" }), setProfile: async () => [] } as any,
    interests: { listInterests: async () => interests, addInterest: async () => true, removeInterest: async () => undefined } as any,
    errors: { listErrors: async () => [], listRecentErrors: async () => [], logError: async () => 1 } as any,
    competency: { getCompetencyVector: async () => { throw new Error("no vector"); } } as any,
    session: { getConversationState: async () => convState } as any,
    learning: { listDueLearningItems: async () => [], markLearningItemsReintroduced: async () => 0 } as any,
  };
}

describe("autonomous opener policy", () => {
  it("injects long-term interests and opener choices for cron starts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-memory-"));
    const memoryPath = path.join(dir, "MEMORY-spanish.md");
    fs.writeFileSync(memoryPath, "El aprendiz recuerda Tenerife, el Teide y el mar como una experiencia tranquila.");

    const builder = new PromptBuilder(repos(["gimnasio", "música", "Canarias", "mar"]), SpanishLanguage);
    const prompt = await builder.build(SpanishLanguage.prompts.morning, memoryPath, { sourceType: "cron" });

    expect(prompt).toContain("## Autonomous conversation opener policy");
    expect(prompt).toContain("Do NOT assume the new conversation must continue the previous thread");
    expect(prompt).toContain("gimnasio, música, Canarias, mar");
    expect(prompt).toContain("Tenerife");
  });

  it("does not inject the autonomous opener policy during normal user chat", async () => {
    const builder = new PromptBuilder(repos(["Canarias", "mar"]), SpanishLanguage);
    const prompt = await builder.build("hola", undefined, { sourceType: "user_chat" });

    expect(prompt).not.toContain("## Autonomous conversation opener policy");
    expect(prompt).not.toContain("Canarias, mar");
  });

  it("uses an opener-specific dialogue plan for cron starts", () => {
    const plan = buildConversationPlan({ userMessage: SpanishLanguage.prompts.morning, history: [], sourceType: "cron" });

    expect(plan).toContain("apertura autónoma");
    expect(plan).toContain("No trates el último hilo como obligatorio");
  });
});
