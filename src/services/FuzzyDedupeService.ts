import type { FuzzyLearningItemDuplicateCandidate, FuzzyLearningItemDuplicateDecision } from "../domain/types.js";
import type { LearningRepository } from "../repositories/interfaces.js";
import type { LLMProvider } from "../providers/interfaces.js";

interface AdjudicationResponse {
  decisions?: FuzzyLearningItemDuplicateDecision[];
}

export interface FuzzyDedupeAdjudicateOptions {
  limit?: number;
  scanLimit?: number;
  batchSize?: number;
}

export interface FuzzyDedupeApplyOptions extends FuzzyDedupeAdjudicateOptions {
  minConfidence?: number;
}

export interface FuzzyDedupeAdjudicationResult {
  candidates: FuzzyLearningItemDuplicateCandidate[];
  decisions: FuzzyLearningItemDuplicateDecision[];
}

export interface FuzzyDedupeApplyResult extends FuzzyDedupeAdjudicationResult {
  appliedMerges: number;
  skippedMerges: number;
}

function itemPayload(candidate: FuzzyLearningItemDuplicateCandidate): object {
  const item = (value: typeof candidate.itemA) => ({
    id: value.id,
    type: value.type,
    title: value.title,
    prompt_l2: value.prompt_l2,
    explanation_l1: value.explanation_l1,
    evidence_snippet: value.evidence_snippet,
    priority: value.priority,
    passive_score: value.passive_score,
    active_score: value.active_score,
    evidence_count: value.evidence_count,
  });
  return {
    itemA: item(candidate.itemA),
    itemB: item(candidate.itemB),
    similarity: {
      score: candidate.score,
      title: candidate.titleSimilarity,
      prompt: candidate.promptSimilarity,
      explanation: candidate.explanationSimilarity,
      tokens: candidate.tokenSimilarity,
      reason: candidate.reason,
    },
  };
}

function normalizeDecision(raw: FuzzyLearningItemDuplicateDecision, candidates: FuzzyLearningItemDuplicateCandidate[]): FuzzyLearningItemDuplicateDecision | null {
  const itemAId = Number(raw.itemAId);
  const itemBId = Number(raw.itemBId);
  const pair = candidates.find((candidate) => {
    const ids = [candidate.itemA.id, candidate.itemB.id].sort((a, b) => a - b);
    const rawIds = [itemAId, itemBId].sort((a, b) => a - b);
    return ids[0] === rawIds[0] && ids[1] === rawIds[1];
  });
  if (!pair) return null;
  const decision = raw.decision === "merge" || raw.decision === "related" || raw.decision === "keep_separate" ? raw.decision : "keep_separate";
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const keeperId = Number(raw.keeperId);
  return {
    itemAId: pair.itemA.id,
    itemBId: pair.itemB.id,
    decision,
    keeperId: Number.isFinite(keeperId) ? keeperId : undefined,
    confidence,
    reason: String(raw.reason ?? "").trim() || "No reason provided.",
    mergedTitle: raw.mergedTitle?.trim() || undefined,
    mergedPromptL2: raw.mergedPromptL2?.trim() || undefined,
    mergedExplanationL1: raw.mergedExplanationL1?.trim() || undefined,
  };
}

export class FuzzyDedupeService {
  constructor(private readonly learning: LearningRepository, private readonly provider: LLMProvider) {}

  async adjudicate(options: FuzzyDedupeAdjudicateOptions = {}): Promise<FuzzyDedupeAdjudicationResult> {
    const candidates = await this.learning.findFuzzyLearningItemDuplicateCandidates({ limit: options.limit ?? 50, scanLimit: options.scanLimit });
    if (candidates.length === 0) return { candidates, decisions: [] };
    const batchSize = Math.max(1, Math.min(12, Math.round(options.batchSize ?? 8)));
    const systemPrompt = [
      "You deduplicate Spanish learning items for a conversation-first tutor.",
      "Classify each candidate pair as exactly one of: merge, related, keep_separate.",
      "Use merge only when both rows teach the same learner target and one row can safely archive into the other.",
      "Use related when the rows overlap, one contains the other, or they share an error pattern but should remain distinct learning targets.",
      "Use keep_separate when they merely share an example sentence, generic explanation, or broad grammar theme.",
      "Prefer the keeper with stronger evidence_count/scores/priority unless the other title is clearly better.",
      "Return strict JSON: {\"decisions\":[{\"itemAId\":number,\"itemBId\":number,\"decision\":\"merge|related|keep_separate\",\"keeperId\":number optional,\"confidence\":0..1,\"reason\":string,\"mergedTitle\":string optional,\"mergedPromptL2\":string optional,\"mergedExplanationL1\":string optional}]}",
    ].join("\n");
    const decisions: FuzzyLearningItemDuplicateDecision[] = [];
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      const userPrompt = JSON.stringify({ batch: { offset, size: batch.length }, candidates: batch.map(itemPayload) }, null, 2);
      const response = await this.provider.completeJson<AdjudicationResponse>(systemPrompt, userPrompt, {
        temperature: 0,
        structured: true,
        maxTokens: 8000,
        timeoutMs: 120_000,
      });
      decisions.push(...(response.decisions ?? [])
        .map((decision) => normalizeDecision(decision, batch))
        .filter((decision): decision is FuzzyLearningItemDuplicateDecision => decision !== null));
    }
    return { candidates, decisions };
  }

  async adjudicateAndApply(options: FuzzyDedupeApplyOptions = {}): Promise<FuzzyDedupeApplyResult> {
    const minConfidence = Math.max(0, Math.min(1, options.minConfidence ?? 0.92));
    const result = await this.adjudicate(options);
    let appliedMerges = 0;
    let skippedMerges = 0;
    for (const decision of result.decisions) {
      if (decision.decision !== "merge" || decision.confidence < minConfidence) {
        if (decision.decision === "merge") skippedMerges++;
        continue;
      }
      const pair = result.candidates.find((candidate) => {
        const ids = [candidate.itemA.id, candidate.itemB.id].sort((a, b) => a - b);
        const decisionIds = [decision.itemAId, decision.itemBId].sort((a, b) => a - b);
        return ids[0] === decisionIds[0] && ids[1] === decisionIds[1];
      });
      if (!pair || !decision.keeperId || ![decision.itemAId, decision.itemBId].includes(decision.keeperId)) {
        skippedMerges++;
        continue;
      }
      const strongSignal = pair.promptSimilarity >= 0.95 || pair.titleSimilarity >= 0.7 || pair.tokenSimilarity >= 0.58;
      if (!strongSignal) {
        skippedMerges++;
        continue;
      }
      const applied = await this.learning.applyFuzzyLearningItemMerge(decision);
      if (applied) appliedMerges++;
      else skippedMerges++;
    }
    return { ...result, appliedMerges, skippedMerges };
  }
}
