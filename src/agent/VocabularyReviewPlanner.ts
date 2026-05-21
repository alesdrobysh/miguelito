import type { VocabRepository } from "../repositories/interfaces.js";
import type { VocabReviewMode } from "../domain/types.js";

export interface ScheduledReviewPlan {
  productiveWords: string[];
  receptiveWords: string[];
}

export class VocabularyReviewPlanner {
  constructor(private vocab: VocabRepository) {}

  async select(): Promise<ScheduledReviewPlan> {
    const productiveWords = await this.dueWords(1, "productive");
    const productiveSet = new Set(productiveWords.map((w) => w.toLowerCase()));
    const receptiveWords = (await this.dueWords(5, "receptive"))
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
