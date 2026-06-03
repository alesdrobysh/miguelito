import { describe, it, expect, vi } from "vitest";
import { DreamService } from "./DreamService.js";
import type { SessionRepository, ErrorRepository, CompetencyRepository, MetaRepository } from "../repositories/interfaces.js";
import type { LLMProvider } from "../providers/interfaces.js";

function makeRepos() {
  const session: SessionRepository = {
    addChatMessage: vi.fn(),
    getChatHistory: vi.fn(),
    getSessionTranscript: vi.fn(),
    getTodaysMessages: vi.fn().mockResolvedValue([
      { role: "user", content: "Hola", created_at: "2026-06-03 10:00:00" },
    ]),
    getConversationState: vi.fn(),
    updateConversationState: vi.fn(),
  };
  const errors: ErrorRepository = {
    logError: vi.fn(),
    listErrors: vi.fn(),
    listRecentErrors: vi.fn().mockResolvedValue([]),
  };
  const competency: CompetencyRepository = {
    getCompetencyVector: vi.fn().mockResolvedValue({
      morph_obs: 0, morph_trials: 0, morph_successes: 0,
      idiom_obs: 0, idiom_trials: 0, idiom_successes: 0,
    }),
    updateCompetencyVector: vi.fn(),
    insertTurnAnnotation: vi.fn(),
    getRecentAnnotations: vi.fn().mockResolvedValue([]),
    insertProficiencyEvidence: vi.fn(),
    listProficiencyEvidence: vi.fn(),
    getTypicalVocabBand: vi.fn(),
  };
  const meta: MetaRepository = {
    getMetaValue: vi.fn().mockResolvedValue(null),
    setMetaValue: vi.fn().mockResolvedValue(undefined),
  };
  const provider: LLMProvider = {
    chat: vi.fn().mockResolvedValue({ content: "Updated memory content", toolCalls: [] }),
    complete: vi.fn(),
    completeJson: vi.fn(),
  };
  return { session, errors, competency, meta, provider };
}

describe("DreamService", () => {
  it("writes last_dream_date after a successful run", async () => {
    const { session, errors, competency, meta, provider } = makeRepos();
    const svc = new DreamService(session, errors, competency, provider, {
      timezone: "UTC",
      dreamMemoryPath: "/tmp/dream-test-memory.md",
      dreamSystemPrompt: "You are a memory updater.",
      morphologyCategories: new Set(),
      langId: "spanish",
    }, meta);

    await svc.run();

    expect(meta.setMetaValue).toHaveBeenCalledWith(
      "last_dream_date:spanish",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("does not write date when there are no messages", async () => {
    const { session, errors, competency, meta, provider } = makeRepos();
    (session.getTodaysMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const svc = new DreamService(session, errors, competency, provider, {
      timezone: "UTC",
      dreamMemoryPath: "/tmp/dream-test-memory.md",
      dreamSystemPrompt: "You are a memory updater.",
      morphologyCategories: new Set(),
      langId: "spanish",
    }, meta);

    await svc.run();

    expect(meta.setMetaValue).not.toHaveBeenCalled();
  });
});
