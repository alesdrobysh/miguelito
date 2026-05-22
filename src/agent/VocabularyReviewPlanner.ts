import type { VocabRepository } from "../repositories/interfaces.js";
import type { VocabReviewMode } from "../domain/types.js";

export interface ScheduledReviewPlan {
  productiveWords: string[];
  receptiveWords: string[];
}

export interface ReviewPlannerOptions {
  /** Number of turns already completed in the current conversation session. */
  turnCount?: number;
}

export class VocabularyReviewPlanner {
  constructor(private vocab: VocabRepository) {}

  async select(options: ReviewPlannerOptions = {}): Promise<ScheduledReviewPlan> {
    const productivePool = await this.dueWords(6, "productive");
    const receptivePool = await this.dueWords(6, "receptive");
    const dueVocabularyIsTiny = new Set([...productivePool, ...receptivePool].map((w) => w.toLowerCase())).size <= 2;

    // When the learner has only one or two due items, injecting them every turn
    // makes the tutor sound stuck on the same topic. Keep SRS present but spaced:
    // first turn of a session, then roughly every third turn.
    if (dueVocabularyIsTiny && (options.turnCount ?? 0) % 3 !== 0) {
      return { productiveWords: [], receptiveWords: [] };
    }

    const productiveWords = productivePool.slice(0, 1);
    const productiveSet = new Set(productiveWords.map((w) => w.toLowerCase()));
    const receptiveWords = receptivePool
      .filter((w) => !productiveSet.has(w.toLowerCase()))
      .slice(0, 3);
    return { productiveWords, receptiveWords };
  }

  private async dueWords(limit: number, mode: VocabReviewMode): Promise<string[]> {
    try {
      return (await this.vocab.dueVocab(limit, mode)).map((r) => r.chunk_l2);
    } catch {
      return [];
    }
  }
}
