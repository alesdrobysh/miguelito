import type { LanguageConfig } from "../languages/LanguageConfig.js";

export type FrequencyBand = "top_1k" | "top_3k" | "top_6k" | "top_10k" | "top_50k" | "rare_or_unknown";

export interface TokenDifficulty {
  token: string;
  rank: number | null;
  band: FrequencyBand;
  rarityScore: number;
}

export interface TextDifficultyProfile {
  /** Frequency/rarity score in [0, 1], where 0 is very common and 1 is rare. */
  lexicalRarity: number;
  /** Back-compat alias for older callers; use lexicalRarity for new code. */
  lexicalDifficulty: number;
  highestBand: FrequencyBand;
  rareTokens: TokenDifficulty[];
  tokensConsidered: number;
  coverage: number;
  source: string;
}

const BAND_SCORE: Record<FrequencyBand, number> = {
  top_1k: 0.10,
  top_3k: 0.25,
  top_6k: 0.45,
  top_10k: 0.62,
  top_50k: 0.80,
  // Unknown/OOV is deliberately not treated as maximally rare evidence: it can
  // be a typo, proper noun, foreign token, or unlisted inflection.
  rare_or_unknown: 0.50,
};

const BAND_RANK: Record<FrequencyBand, number> = {
  top_1k: 1,
  top_3k: 2,
  top_6k: 3,
  top_10k: 4,
  top_50k: 5,
  rare_or_unknown: 3,
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
    return { lexicalRarity: 0.1, lexicalDifficulty: 0.1, highestBand: "top_1k", rareTokens: [], tokensConsidered: 0, coverage: words.length ? 1 : 0, source };
  }

  const analyzed = tokens.map((token): TokenDifficulty => {
    let r = rank.get(token) ?? null;
    const lemma = lemmatize ? lemmatize(token) : token;
    if (r === null && lemma !== token) r = lemmaRank.get(lemma) ?? null;

    const band = rankToBand(r);
    return { token, rank: r, band, rarityScore: BAND_SCORE[band] };
  });

  const known = analyzed.filter((x) => x.rank !== null).length;
  const top = analyzed.reduce((best, x) => BAND_RANK[x.band] > BAND_RANK[best.band] ? x : best, analyzed[0]);
  const avg = analyzed.reduce((s, x) => s + x.rarityScore, 0) / analyzed.length;
  const hardShare = analyzed.filter((x) => x.band === "top_10k" || x.band === "top_50k" || x.band === "rare_or_unknown").length / analyzed.length;
  const lexicalRarity = clamp01(avg * 0.75 + hardShare * 0.25);
  const rareTokens = analyzed
    .filter((x) => x.band === "top_10k" || x.band === "top_50k" || x.band === "rare_or_unknown")
    .slice(0, 8);

  return {
    lexicalRarity,
    lexicalDifficulty: lexicalRarity,
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

// Frequency thresholds over the bundled Spanish corpus: a common↔rare gradient.
function rankToBand(rank: number | null): FrequencyBand {
  if (rank === null) return "rare_or_unknown";
  if (rank <= 2000) return "top_1k";
  if (rank <= 5000) return "top_3k";
  if (rank <= 12000) return "top_6k";
  if (rank <= 25000) return "top_10k";
  return "top_50k";
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}][\p{L}''-]*/gu) ?? []).map((t) => t.replace(/['']/g, "'"));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}
