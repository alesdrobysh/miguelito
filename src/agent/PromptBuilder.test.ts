import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { PromptBuilder } from "./PromptBuilder.js";
import { buildConversationPlan } from "./ConversationPlanner.js";
import { SpanishLanguage } from "../languages/spanish/index.js";
import type { PromptRepos } from "./PromptBuilder.js";

function repos(interests: string[] = [], dueLearningItems: any[] = []): PromptRepos {
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
    learning: { listDueLearningItems: async () => dueLearningItems, markLearningItemsReintroduced: async () => 0 } as any,
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
    expect(prompt).toContain("not an agenda");
  });

  it("diversifies autonomous opener interests instead of letting one recent gym cluster dominate", async () => {
    const interests = [
      "calistenia",
      "gimnasio",
      "entrenamiento",
      "ejercicio",
      "entrenar",
      "entrenar con pesos",
      "pesas",
      "fútbol",
      "música",
      "libros",
      "viajes",
      "Canarias",
    ];
    const builder = new PromptBuilder(repos(interests), SpanishLanguage);
    const prompt = await builder.build(SpanishLanguage.prompts.morning, undefined, { sourceType: "cron" });

    const available = prompt.match(/Available interests include: ([^.]+)\./)?.[1] ?? "";
    expect(available).toContain("fútbol");
    expect(available).toContain("música");
    expect(available).toContain("libros");
    expect(available).toContain("viajes");
    expect((available.match(/gimnasio|entren|pesas|calistenia|ejercicio/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("treats due learning items as optional hooks during autonomous openers", async () => {
    const due = [
      { id: 18, title: "me entreno → entreno", type: "correction", passive_score: 0, active_score: 0, reactivation_pressure: "high" },
      { id: 53, title: "overhead squats", type: "phrase", passive_score: 0, active_score: 0.2, reactivation_pressure: "high" },
    ];
    const builder = new PromptBuilder(repos(["gimnasio", "música", "viajes"], due), SpanishLanguage);
    const prompt = await builder.build(SpanishLanguage.prompts.morning, undefined, { sourceType: "cron" });

    expect(prompt).toContain("Optional learning hooks due");
    expect(prompt).toContain("Do not let due items override opener variety");
    expect(prompt).not.toContain("These are priority learning targets. Weave exactly one into this turn");
  });

  it("does not mark due learning items reintroduced while only building the prompt", async () => {
    const marked: number[][] = [];
    const reposWithDue = repos([], [{ id: 18, title: "partida → partido", type: "correction", passive_score: 0, active_score: 0, reactivation_pressure: "high" }]);
    reposWithDue.learning.markLearningItemsReintroduced = async (ids: number[]) => { marked.push(ids); return ids.length; };
    const builder = new PromptBuilder(reposWithDue, SpanishLanguage);

    const prompt = await builder.build("No hay ninguna partida interesante", undefined, { sourceType: "user_chat" });

    expect(prompt).toContain("partida → partido");
    expect(marked).toEqual([]);
  });

  it("does not drag generic rest messages back to training just because training hooks are due", async () => {
    const due = [
      { id: 17, title: "entrenar con pesos", type: "phrase", passive_score: 0.2, active_score: 0, reactivation_pressure: "high" },
      { id: 53, title: "overhead squats", type: "phrase", passive_score: 0, active_score: 0.2, reactivation_pressure: "high" },
    ];
    const builder = new PromptBuilder(repos(["gimnasio", "descanso", "músculos"], due), SpanishLanguage);

    const prompt = await builder.build("He tenido mucho tiempo para descansar", undefined, { sourceType: "user_chat" });

    expect(prompt).not.toContain("entrenar con pesos");
    expect(prompt).not.toContain("overhead squats");
    expect(prompt).not.toContain("These are priority learning targets. Weave exactly one into this turn");
  });

  it("injects due learning items when the user asks for generic practice", async () => {
    const due = [
      { id: 252, title: "Me parece impactante / efectivo / sugerente", type: "phrase", passive_score: 0, active_score: 0, reactivation_pressure: "medium" },
      { id: 270, title: "Me ha dicho que...", type: "phrase", passive_score: 0, active_score: 0, reactivation_pressure: "medium" },
    ];
    const builder = new PromptBuilder(repos([], due), SpanishLanguage);

    const prompt = await builder.build("quiero practicar learning items", undefined, { sourceType: "user_chat" });

    expect(prompt).toContain("Explicit practice request: due learning items");
    expect(prompt).toContain("Pick exactly one item from this list");
    expect(prompt).toContain("Respect exclusions like \"sin gimnasio\"");
    expect(prompt).toContain("Me parece impactante / efectivo / sugerente");
    expect(prompt).toContain("Me ha dicho que...");
  });

  it("injects due imported practice items into normal chat even when the latest topic is different", async () => {
    const due = [
      { id: 301, title: "bochorno", type: "phrase", source_type: "imported", passive_score: 0, active_score: 0, reactivation_pressure: "high" },
      { id: 17, title: "entrenar con pesos", type: "phrase", source_type: "conversation", passive_score: 0.2, active_score: 0, reactivation_pressure: "high" },
    ];
    const builder = new PromptBuilder(repos([], due), SpanishLanguage);

    const prompt = await builder.build("Hoy quiero hablar de libros", undefined, { sourceType: "user_chat" });

    expect(prompt).toContain("Imported practice items due");
    expect(prompt).toContain("bochorno");
    expect(prompt).not.toContain("entrenar con pesos");
  });

  it("does not treat ordinary sports training talk as generic learning practice intent", async () => {
    const due = [
      { id: 252, title: "Me parece impactante / efectivo / sugerente", type: "phrase", passive_score: 0, active_score: 0, reactivation_pressure: "medium" },
    ];
    const builder = new PromptBuilder(repos([], due), SpanishLanguage);

    const prompt = await builder.build("Hoy quiero entrenar en el gimnasio", undefined, { sourceType: "user_chat" });

    expect(prompt).not.toContain("Conversation-native learning items due");
  });

  it("does not inject the autonomous opener policy during normal user chat", async () => {
    const builder = new PromptBuilder(repos(["Canarias", "mar"]), SpanishLanguage);
    const prompt = await builder.build("hola", undefined, { sourceType: "user_chat" });

    expect(prompt).not.toContain("## Autonomous conversation opener policy");
    expect(prompt).not.toContain("Canarias, mar");
  });

  it("uses critical severity notes as next-turn prompt context", async () => {
    const withError = repos([]);
    withError.errors.listErrors = async () => [{ id: 1, user_text: "la problema", correct_form: "el problema", category: "gender", note: "severity:critical" } as any];
    const builder = new PromptBuilder(withError, SpanishLanguage);

    const prompt = await builder.build("hola", undefined, { sourceType: "user_chat" });

    expect(prompt).toContain("Prioriza una corrección breve si reaparece este patrón.");
    expect(prompt).not.toContain("severity:critical");
  });

  it("uses an opener-specific dialogue plan for cron starts", () => {
    const plan = buildConversationPlan({ userMessage: SpanishLanguage.prompts.morning, history: [], sourceType: "cron" });

    expect(plan).toContain("apertura autónoma");
    expect(plan).toContain("No trates el último hilo como obligatorio");
  });
});
