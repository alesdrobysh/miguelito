import type { LanguageConfig } from "../languages/LanguageConfig.js";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type FrequencyBand = "top_1k" | "top_3k" | "top_6k" | "top_10k" | "rare_or_unknown";

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
  top_1k: 0.12,
  top_3k: 0.30,
  top_6k: 0.52,
  top_10k: 0.72,
  rare_or_unknown: 0.92,
};
const BAND_LEVEL: Record<FrequencyBand, CefrLevel> = {
  top_1k: "A1",
  top_3k: "A2",
  top_6k: "B1",
  top_10k: "B2",
  rare_or_unknown: "C1",
};

const STOPLIKE = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "for", "with",
  "de", "la", "el", "que", "y", "a", "en", "un", "una", "es", "lo", "por", "con",
  "nie", "to", "się", "w", "na", "i", "że", "z", "co", "jest", "do", "tak",
]);

export function analyzeTextDifficulty(text: string, lang: LanguageConfig): TextDifficultyProfile {
  const words = lang.frequency?.topWords ?? [];
  const source = lang.frequency?.source ?? "no frequency list configured";
  const rank = new Map<string, number>();
  words.forEach((w, i) => rank.set(w.toLowerCase(), i + 1));
  const rawTokens = tokenize(text);
  const tokens = rawTokens.filter((t) => t.length > 2 && !STOPLIKE.has(t));
  if (tokens.length === 0) {
    return { lexicalDifficulty: 0.1, estimatedLevel: "A1", highestBand: "top_1k", rareTokens: [], tokensConsidered: 0, coverage: words.length ? 1 : 0, source };
  }

  const analyzed = tokens.map((token): TokenDifficulty => {
    const r = rank.get(token) ?? null;
    const band = rankToBand(r);
    return { token, rank: r, band, level: BAND_LEVEL[band] };
  });

  const known = analyzed.filter((x) => x.rank !== null).length;
  const top = analyzed.reduce((best, x) => LEVEL_SCORE[x.level] > LEVEL_SCORE[best.level] ? x : best, analyzed[0]);
  const avg = analyzed.reduce((s, x) => s + BAND_SCORE[x.band], 0) / analyzed.length;
  const hardShare = analyzed.filter((x) => x.band === "top_10k" || x.band === "rare_or_unknown").length / analyzed.length;
  const lexicalDifficulty = clamp01(avg * 0.75 + hardShare * 0.25);
  const level = SCORE_LEVEL[Math.max(0, Math.min(SCORE_LEVEL.length - 1, Math.round(lexicalDifficulty * 5)))] ?? top.level;
  const rareTokens = analyzed
    .filter((x) => x.band === "top_10k" || x.band === "rare_or_unknown")
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

function rankToBand(rank: number | null): FrequencyBand {
  if (rank === null) return "rare_or_unknown";
  if (rank <= 1000) return "top_1k";
  if (rank <= 3000) return "top_3k";
  if (rank <= 6000) return "top_6k";
  if (rank <= 10000) return "top_10k";
  return "rare_or_unknown";
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []).map((t) => t.replace(/[’']/g, "'"));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}
