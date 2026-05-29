import type { LanguageConfig } from "../languages/LanguageConfig.js";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type FrequencyBand = "top_1k" | "top_3k" | "top_6k" | "top_10k" | "top_50k" | "rare_or_unknown";

export interface TokenDifficulty {
  token: string;
  rank: number | null;
  band: FrequencyBand;
  level: CefrLevel;
}

export interface TextDifficultyProfile {
  lexicalDifficulty: number;
  estimatedLevel: CefrLevel;
  highestBand: FrequencyBand;
  rareTokens: TokenDifficulty[];
  tokensConsidered: number;
  coverage: number;
  source: string;
}

const LEVEL_SCORE: Record<CefrLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
const SCORE_LEVEL: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const BAND_SCORE: Record<FrequencyBand, number> = {
  top_1k: 0.10,
  top_3k: 0.25,
  top_6k: 0.45,
  top_10k: 0.62,
  top_50k: 0.80,
  rare_or_unknown: 0.95,
};
const BAND_LEVEL: Record<FrequencyBand, CefrLevel> = {
  top_1k: "A1",
  top_3k: "A2",
  top_6k: "B1",
  top_10k: "B2",
  top_50k: "C1",
  rare_or_unknown: "C2",
};
// Reverse map used when a CEFR override lowers the band.
const LEVEL_BAND: Record<CefrLevel, FrequencyBand> = {
  A1: "top_1k", A2: "top_3k", B1: "top_6k", B2: "top_10k", C1: "top_50k", C2: "rare_or_unknown",
};

const STOPLIKE = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "for", "with",
  "de", "la", "el", "que", "y", "a", "en", "un", "una", "es", "lo", "por", "con",
  "nie", "to", "się", "w", "na", "i", "że", "z", "co", "jest", "do", "tak",
]);

export function analyzeTextDifficulty(text: string, lang: LanguageConfig): TextDifficultyProfile {
  const words = lang.frequency?.topWords ?? [];
  const source = lang.frequency?.source ?? "no frequency list configured";
  const lemmatize = lang.frequency?.lemmatize;
  const cefrLevels = lang.frequency?.cefrLevels;

  const rank = new Map<string, number>();
  words.forEach((w, i) => rank.set(w.toLowerCase(), i + 1));

  // Build lemma → best (lowest) rank map so that inflected forms not in the
  // list can fall back to the most common attested form of the same lemma.
  const lemmaRank = new Map<string, number>();
  if (lemmatize) {
    words.forEach((w, i) => {
      const lemma = lemmatize(w.toLowerCase());
      const r = i + 1;
      const cur = lemmaRank.get(lemma);
      if (cur === undefined || r < cur) lemmaRank.set(lemma, r);
    });
  }

  const rawTokens = tokenize(text);
  const tokens = rawTokens.filter((t) => t.length > 2 && !STOPLIKE.has(t));
  if (tokens.length === 0) {
    return { lexicalDifficulty: 0.1, estimatedLevel: "A1", highestBand: "top_1k", rareTokens: [], tokensConsidered: 0, coverage: words.length ? 1 : 0, source };
  }

  const analyzed = tokens.map((token): TokenDifficulty => {
    let r = rank.get(token) ?? null;
    const lemma = lemmatize ? lemmatize(token) : token;
    if (r === null && lemma !== token) r = lemmaRank.get(lemma) ?? null;

    let band = rankToBand(r);
    let level = BAND_LEVEL[band];

    // CEFR override: if a curated level list assigns a lower (easier) level,
    // use it — taking the minimum prevents mis-assignments from thematic lists
    // where a common word appears only in an advanced domain context.
    if (cefrLevels) {
      const override = cefrLevels.get(token) ?? (lemma !== token ? cefrLevels.get(lemma) : undefined);
      if (override && LEVEL_SCORE[override] < LEVEL_SCORE[level]) {
        level = override;
        band = LEVEL_BAND[override];
      }
    }

    return { token, rank: r, band, level };
  });

  const known = analyzed.filter((x) => x.rank !== null).length;
  const top = analyzed.reduce((best, x) => LEVEL_SCORE[x.level] > LEVEL_SCORE[best.level] ? x : best, analyzed[0]);
  const avg = analyzed.reduce((s, x) => s + BAND_SCORE[x.band], 0) / analyzed.length;
  const hardShare = analyzed.filter((x) => x.band === "top_10k" || x.band === "top_50k" || x.band === "rare_or_unknown").length / analyzed.length;
  const lexicalDifficulty = clamp01(avg * 0.75 + hardShare * 0.25);
  const level = SCORE_LEVEL[Math.max(0, Math.min(SCORE_LEVEL.length - 1, Math.round(lexicalDifficulty * 5)))] ?? top.level;
  const rareTokens = analyzed
    .filter((x) => x.band === "top_10k" || x.band === "top_50k" || x.band === "rare_or_unknown")
    .slice(0, 8);

  return {
    lexicalDifficulty,
    estimatedLevel: LEVEL_SCORE[top.level] > LEVEL_SCORE[level] ? top.level : level,
    highestBand: top.band,
    rareTokens,
    tokensConsidered: analyzed.length,
    coverage: words.length ? known / analyzed.length : 0,
    source,
  };
}

export function outcomeScore(comprehension: string): number {
  if (comprehension === "smooth") return 1;
  if (comprehension === "asked_clarify") return 0.45;
  if (comprehension === "requested_simpler") return 0;
  return 0.5;
}

// Thresholds calibrated against PCIC CEFR distribution in the 50k corpus.
function rankToBand(rank: number | null): FrequencyBand {
  if (rank === null) return "rare_or_unknown";   // C2: not in top 50k
  if (rank <= 2000) return "top_1k";             // A1
  if (rank <= 5000) return "top_3k";             // A2
  if (rank <= 12000) return "top_6k";            // B1
  if (rank <= 25000) return "top_10k";           // B2
  return "top_50k";                              // C1: ranks 25001–50000
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}][\p{L}''-]*/gu) ?? []).map((t) => t.replace(/['']/g, "'"));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}
