import type { CompetencyRepository, VocabRepository } from "../repositories/interfaces.js";

export type Confidence = "low" | "medium" | "high";
export type Axis = "lexicon" | "syntax" | "morphology" | "idiomaticity";

export interface CompetencyVector {
  lexicon: {
    activeChunks: number;
    confidence: Confidence;
  };
  syntax: {
    meanTunitLength: number;
    subIndex: number;
    confidence: Confidence;
  };
  morphology: {
    rate: number;
    obs: number;
    confidence: Confidence;
  };
  idiomaticity: {
    rate: number;
    obs: number;
    confidence: Confidence;
  };
  reception: {
    level: number;
    obs: number;
    confidence: Confidence;
  };
}

function obsToConfidence(obs: number): Confidence {
  if (obs < 5) return "low";
  if (obs < 30) return "medium";
  return "high";
}

export async function getCompetencyVector(repos: {
  competency: CompetencyRepository;
  vocab: VocabRepository;
}): Promise<CompetencyVector> {
  const [vec, learning, review, mastered] = await Promise.all([
    repos.competency.getCompetencyVector(),
    repos.vocab.listVocab("learning", 9999),
    repos.vocab.listVocab("review", 9999),
    repos.vocab.listVocab("mastered", 9999),
  ]);

  const activeChunks = learning.length + review.length + mastered.length;
  const lexiconConf = activeChunks < 5 ? "low" : activeChunks < 30 ? "medium" : "high";

  type SyntaxEntry = { tunit_length: number; had_sub: boolean };
  let syntaxWindow: SyntaxEntry[] = [];
  try {
    const parsed = JSON.parse(vec.syntax_window);
    if (Array.isArray(parsed)) syntaxWindow = parsed;
  } catch {}

  const n = syntaxWindow.length;
  const meanTunitLength = n > 0 ? syntaxWindow.reduce((s, e) => s + (e.tunit_length ?? 1), 0) / n : 1;
  const subIndex = n > 0 ? syntaxWindow.filter((e) => e.had_sub).length / n : 0;

  const morphRate = vec.morph_trials > 0.01 ? vec.morph_successes / vec.morph_trials : 0.5;
  const idiomRate = vec.idiom_trials > 0.01 ? vec.idiom_successes / vec.idiom_trials : 0.5;

  return {
    lexicon: { activeChunks, confidence: lexiconConf },
    syntax: { meanTunitLength, subIndex, confidence: obsToConfidence(n) },
    morphology: { rate: morphRate, obs: vec.morph_obs, confidence: obsToConfidence(vec.morph_obs) },
    idiomaticity: { rate: idiomRate, obs: vec.idiom_obs, confidence: obsToConfidence(vec.idiom_obs) },
    reception: { level: vec.reception_ewma, obs: vec.reception_obs, confidence: obsToConfidence(vec.reception_obs) },
  };
}

export function selectFocusAxis(v: CompetencyVector): Axis | null {
  const weak: Axis[] = [];

  if (v.morphology.confidence !== "low" && v.morphology.rate < 0.75) weak.push("morphology");
  if (v.idiomaticity.confidence !== "low" && v.idiomaticity.rate < 0.70) weak.push("idiomaticity");
  if (v.lexicon.confidence !== "low" && v.lexicon.activeChunks < 30) weak.push("lexicon");
  if (v.syntax.confidence !== "low" && (v.syntax.meanTunitLength < 6 || v.syntax.subIndex < 0.15)) {
    weak.push("syntax");
  }

  if (weak.length === 0) return null;

  for (const axis of ["morphology", "idiomaticity", "lexicon", "syntax"] as Axis[]) {
    if (weak.includes(axis)) return axis;
  }
  return weak[0];
}

export function renderCalibration(v: CompetencyVector, focus: Axis | null): string {
  const lines: string[] = ["## Difficulty Calibration"];

  if (v.lexicon.confidence === "low") {
    lines.push("Vocabulary: use natural, varied vocabulary appropriate for a developing learner.");
  } else if (focus === "lexicon") {
    lines.push("Vocabulary: introduce ~1 mid-frequency word (rank 3,000–8,000) per turn, woven naturally into context — do not stay only in the top-1,000 band.");
  } else {
    lines.push("Vocabulary: keep mostly within the top-3,000 band; mid-frequency words are fine when they fit naturally.");
  }

  if (v.syntax.confidence === "low") {
    lines.push("Syntax: use clear, mostly simple sentences.");
  } else if (focus === "syntax") {
    lines.push(
      `Syntax: model complex sentences — include subordinate clauses (que + clause, si-clauses, relative clauses); your own output should be one step above learner's current production (${v.syntax.meanTunitLength.toFixed(1)} T-units avg, ${Math.round(v.syntax.subIndex * 100)}% with subordination).`
    );
  } else {
    const label = v.syntax.meanTunitLength < 3 ? "simple" : v.syntax.meanTunitLength < 6 ? "moderate" : "varied";
    lines.push(`Syntax: use ${label} sentence structures; include an occasional subordinate clause.`);
  }

  if (v.morphology.confidence === "low") {
    lines.push("Morphology: use present tense and pretérito freely; introduce other tenses as they arise naturally.");
  } else if (focus === "morphology") {
    const pct = Math.round(v.morphology.rate * 100);
    lines.push(
      `Morphology: learner accuracy ${pct}% on obligatory contexts — model correct verb conjugation and agreement prominently; use imperfecto and subjunctive in contrastive situations to expose the patterns.`
    );
  } else {
    lines.push("Morphology: use present, pretérito, and imperfecto freely; introduce subjunctive contextually.");
  }

  if (v.idiomaticity.confidence === "low") {
    lines.push("Idiomaticity: use natural Spanish; avoid literal translations.");
  } else if (focus === "idiomaticity") {
    const pct = Math.round(v.idiomaticity.rate * 100);
    lines.push(
      `Idiomaticity: naturalness score ${pct}% — prefer idiomatic collocations; model native phrasing prominently and gently flag calques.`
    );
  } else {
    lines.push("Idiomaticity: use natural, idiomatic Spanish; native collocations over literal translations.");
  }

  if (v.reception.confidence !== "low") {
    if (v.reception.level > 0.75) {
      lines.push(`Reception: ${Math.round(v.reception.level * 100)}% smooth — nudge your own output complexity up one step.`);
    } else if (v.reception.level < 0.35) {
      lines.push(`Reception: ${Math.round(v.reception.level * 100)}% smooth — simplify your own output; shorter sentences, more common vocabulary.`);
    }
  }

  return lines.join("\n");
}

export function formatVectorForDisplay(v: CompetencyVector): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const conf = (c: string) => (c === "low" ? " (forming)" : "");

  return [
    `Lexicon: ${v.lexicon.activeChunks} active chunks${conf(v.lexicon.confidence)}`,
    `Syntax: T-units ${v.syntax.meanTunitLength.toFixed(1)}, subordination ${pct(v.syntax.subIndex)}${conf(v.syntax.confidence)}`,
    `Morphology: ${pct(v.morphology.rate)} accuracy${conf(v.morphology.confidence)}`,
    `Idiomaticity: ${pct(v.idiomaticity.rate)} naturalness${conf(v.idiomaticity.confidence)}`,
    `Reception: ${pct(v.reception.level)} smooth${conf(v.reception.confidence)}`,
  ].join(" | ");
}
