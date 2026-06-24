import { describe, it, expect } from "vitest";
import { PostTurnProcessor } from "./PostTurnProcessor.js";
import type { ChatOptions, ChatResult, LLMProvider } from "../providers/interfaces.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { CompetencyRepository, ErrorRepository, InterestRepository, LearningRepository, SessionRepository } from "../repositories/interfaces.js";
import type { LearningItemInput, LearningItemEvidenceInput, TurnAnnotationInput, ProficiencyEvidenceInput } from "../domain/types.js";

class RecordingProvider implements LLMProvider {
  public calls: Array<{ system: string | null; user: string; opts?: ChatOptions }> = [];

  async chat(): Promise<ChatResult> {
    throw new Error("unused");
  }

  async complete(): Promise<string> {
    throw new Error("unused");
  }

  async completeJson<T>(system: string | null, user: string, opts?: ChatOptions): Promise<T> {
    this.calls.push({ system, user, opts });
    if (this.calls.length === 1) {
      return {
        annotation: { naturalness: 1, comprehension: "smooth", lexical_rarity: 0, tunit_length: 4, had_subordination: false, obligatory: [], used: ["voy al gimnasio"] },
        mode: "REACT",
        errors: [{ user_text: "voy gimnasio", correct: "voy al gimnasio", category: "preposition", note: "use al" }],
        interests: ["gimnasio"],
      } as T;
    }
    return {
      learning_items: [{ type: "correction", title: "voy gimnasio → voy al gimnasio", prompt_l2: "voy gimnasio", explanation_l1: "use al", source_type: "correction", priority: 0.9, practice_modes: ["rewrite"] }],
      item_evidence: [{ learning_item_id: 7, skill: "active", event: "spontaneous_production", independence: "spontaneous", score_delta: 0.2, confidence: 0.8, evidence_snippet: "voy al gimnasio" }],
    } as T;
  }
}

const lang: LanguageConfig = {
  id: "es",
  name: "Spanish",
  errorCategories: ["preposition", "other"],
  morphologyCategories: [],
  calibrationThresholds: { morphology: 0, idiomaticity: 0 },
  calibrationText: {
    morphologyLow: "",
    morphologyFocus: () => "",
    morphologyNormal: "",
    idiomaticityLow: "",
    idiomaticityFocus: () => "",
    idiomaticityNormal: "",
  },
  productPolicy: { name: "", mission: "", inputPolicy: "", correctionPolicy: "", toolPolicy: "", visibleSummary: "" },
  promptText: {
    languageBlock: "",
    postHistoryReminder: "",
    learnerProfileConfigured: () => "",
    learnerProfileUnconfigured: "",
    conversationState: () => "",
    currentLearnerProfile: () => "",
    dreamMemory: () => "",
  },
  interestsHeader: "",
  prompts: { morning: "", evening: "", dream: "", readLink: () => "", readingSuggest: () => "" },
  soulPath: "",
};

function makeProcessor(provider: RecordingProvider) {
  const learningItems = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    type: "phrase",
    title: `item ${i + 1}`,
    prompt_l2: `prompt ${i + 1}`,
    passive_score: 0,
    active_score: 0,
    stability: 0,
  }));
  const addedLearningItems: LearningItemInput[] = [];
  const recordedEvidence: LearningItemEvidenceInput[] = [];
  const annotations: TurnAnnotationInput[] = [];
  const interests: string[] = [];

  const processor = new PostTurnProcessor({
    provider,
    lang,
    errors: { logError: async () => 1 } as unknown as ErrorRepository,
    competency: {
      insertTurnAnnotation: async (ann: TurnAnnotationInput) => { annotations.push(ann); },
      insertProficiencyEvidence: async (_evidence: ProficiencyEvidenceInput) => 1,
    } as CompetencyRepository,
    session: {
      getConversationState: async () => ({ session: { session_id: "s1", turn_count: 3, mode: "REACT" }, lastModes: [], moodHint: "", topicsTouched: "" }),
      updateConversationState: async () => ({ ok: true, changed: true }),
    } as unknown as SessionRepository,
    interests: { addInterest: async (interest: string) => { interests.push(interest); return true; } } as unknown as InterestRepository,
    learning: {
      selectLearningItemsForEvaluation: async (_user: string, _assistant: string, limit: number) => learningItems.slice(0, limit),
      getLearningHygieneSnapshot: async () => ({ backlog_status: "healthy", active_without_evidence: 0 }),
      listLearningItems: async (_status: string, limit: number) => learningItems.slice(0, limit),
      addLearningItem: async (input: LearningItemInput) => { addedLearningItems.push(input); return addedLearningItems.length; },
      recordLearningItemEvidence: async (input: LearningItemEvidenceInput) => { recordedEvidence.push(input); return recordedEvidence.length; },
    } as unknown as LearningRepository,
  });

  return { processor, addedLearningItems, recordedEvidence, annotations, interests };
}

describe("PostTurnProcessor extraction", () => {
  it("splits deterministic post-turn extraction into core and learning JSON calls with larger token budgets", async () => {
    const provider = new RecordingProvider();
    const { processor, addedLearningItems, recordedEvidence, annotations, interests } = makeProcessor(provider);

    const result = await processor.process({
      userMessage: "voy al gimnasio",
      assistantText: "Perfecto, vas al gimnasio mañana.",
      chatHistory: [{ role: "user", content: "voy al gimnasio" }],
    });

    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].user).not.toContain("Active learning items that may receive item_evidence");
    expect(provider.calls[1].user).toContain("Active learning items that may receive item_evidence");
    expect(provider.calls.every((call) => (call.opts?.maxTokens ?? 0) >= 2500)).toBe(true);
    expect(annotations).toHaveLength(1);
    expect(addedLearningItems.some((item) => item.title === "voy gimnasio → voy al gimnasio")).toBe(true);
    expect(recordedEvidence).toHaveLength(1);
    expect(interests).toEqual(["gimnasio"]);
  });

  it("limits new learning items when hygiene backlog is blocked", async () => {
    const provider: LLMProvider = {
      chat: async () => { throw new Error("unused"); },
      complete: async () => { throw new Error("unused"); },
      completeJson: async <T,>(_system: string | null, _user: string, _opts?: ChatOptions): Promise<T> => {
        const callCount = ((provider as any).callCount = ((provider as any).callCount ?? 0) + 1);
        if (callCount === 1) {
          return { annotation: { naturalness: 1, comprehension: "smooth", tunit_length: 1, obligatory: [], used: [] }, mode: "REACT", errors: [], interests: [] } as T;
        }
        return {
          learning_items: [
            { type: "phrase", title: "farmer's walk", priority: 0.7 },
            { type: "word", title: "agarre", priority: 0.7 },
            { type: "correction", title: "partida → partido", priority: 0.9 },
            { type: "correction", title: "un otro día → otro día", priority: 0.9 },
          ],
          item_evidence: [],
        } as T;
      },
    };
    const addedLearningItems: LearningItemInput[] = [];
    const processor = new PostTurnProcessor({
      provider,
      lang,
      errors: { logError: async () => 1 } as unknown as ErrorRepository,
      competency: { insertTurnAnnotation: async () => undefined, insertProficiencyEvidence: async () => 1 } as unknown as CompetencyRepository,
      session: {
        getConversationState: async () => ({ session: { session_id: "s1", turn_count: 0, mode: "REACT" }, lastModes: [], moodHint: "", topicsTouched: "" }),
        updateConversationState: async () => ({ ok: true, changed: true }),
      } as unknown as SessionRepository,
      learning: {
        getLearningHygieneSnapshot: async () => ({ backlog_status: "blocked", active_without_evidence: 99 }),
        selectLearningItemsForEvaluation: async () => [],
        listLearningItems: async () => [],
        addLearningItem: async (input: LearningItemInput) => { addedLearningItems.push(input); return addedLearningItems.length; },
        recordLearningItemEvidence: async () => 1,
      } as unknown as LearningRepository,
    });

    await processor.process({ userMessage: "hola", assistantText: "hola", chatHistory: [] });

    expect(addedLearningItems.map((item) => item.title)).toEqual(["partida → partido"]);
  });
});
