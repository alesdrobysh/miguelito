import type { LanguageConfig } from "../languages/LanguageConfig.js";
import type { CompetencyRepository, VocabRepository } from "../repositories/interfaces.js";

export type Confidence = "low" | "medium" | "high";
export type Axis = "lexicon" | "syntax" | "morphology" | "idiomaticity";

export interface CompetencyVector {
  lexicon: {
    activeChunks: number;
    lexicalRarity: number;
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
    byFrequencyBand: Record<string, { score: number | null; obs: number; confidence: Confidence }>;
  };
  monitoring: {
    selfCorrectionObs: number;
  };
}

function obsToConfidence(obs: number): Confidence {
  if (obs < 5) return "low";
  if (obs < 30) return "medium";
  return "high";
}

async function buildReceptionByFrequencyBand(repo: CompetencyRepository): Promise<Record<string, { score: number | null; obs: number; confidence: Confidence }>> {
  const bands = ["top_1k", "top_3k", "top_6k", "top_10k", "top_50k", "rare_or_unknown"];
  const result: Record<string, { score: number | null; obs: number; confidence: Confidence }> = {};
  for (const band of bands) result[band] = { score: null, obs: 0, confidence: "low" };

  const rows = await repo.listProficiencyEvidence(200);
  const outcomeScore: Record<string, number> = { success: 1, partial: 0.5, fail: 0 };
  for (const band of bands) {
    const bucket = rows.filter((r) => r.skill === "reception" && r.dimension === "lexical" && r.level === band);
    const denom = bucket.reduce((s, r) => s + Math.max(0, r.weight) * Math.max(0, Math.min(1, r.confidence)), 0);
    if (denom <= 0) continue;
    const score = bucket.reduce((s, r) => s + (outcomeScore[r.outcome] ?? 0.5) * Math.max(0, r.weight) * Math.max(0, Math.min(1, r.confidence)), 0) / denom;
    result[band] = { score, obs: bucket.length, confidence: obsToConfidence(bucket.length) };
  }
  return result;
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
  const receptionByFrequencyBand = await buildReceptionByFrequencyBand(repos.competency);

  return {
    lexicon: { activeChunks, lexicalRarity: vec.lexical_rarity_ewma, confidence: lexiconConf },
    syntax: { meanTunitLength, subIndex, confidence: obsToConfidence(n) },
    morphology: { rate: morphRate, obs: vec.morph_obs, confidence: obsToConfidence(vec.morph_obs) },
    idiomaticity: { rate: idiomRate, obs: vec.idiom_obs, confidence: obsToConfidence(vec.idiom_obs) },
    reception: { level: vec.reception_ewma, obs: vec.reception_obs, confidence: obsToConfidence(vec.reception_obs), byFrequencyBand: receptionByFrequencyBand },
    monitoring: { selfCorrectionObs: vec.self_correction_obs },
  };
}

export function selectFocusAxis(v: CompetencyVector, lang: LanguageConfig): Axis | null {
  const weak: Axis[] = [];

  if (v.morphology.confidence !== "low" && v.morphology.rate < lang.calibrationThresholds.morphology) weak.push("morphology");
  if (v.idiomaticity.confidence !== "low" && v.idiomaticity.rate < lang.calibrationThresholds.idiomaticity) weak.push("idiomaticity");
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

export function renderCalibration(v: CompetencyVector, focus: Axis | null, lang: LanguageConfig): string {
  const lines: string[] = [calibrationHeader(lang)];

  if (v.lexicon.confidence === "low") {
    lines.push(calibrationLine(lang, "lexiconLow"));
  } else if (focus === "lexicon") {
    lines.push(calibrationLine(lang, "lexiconFocus"));
  } else {
    const rarity = v.lexicon.lexicalRarity;
    lines.push(calibrationLexiconMatch(lang, rarity));
  }

  if (v.syntax.confidence === "low") {
    lines.push(calibrationLine(lang, "syntaxLow"));
  } else if (focus === "syntax") {
    lines.push(calibrationSyntaxFocus(lang, v.syntax.meanTunitLength, v.syntax.subIndex));
  } else {
    lines.push(calibrationSyntaxNormal(lang, v.syntax.meanTunitLength));
  }

  if (v.morphology.confidence === "low") {
    lines.push(calibrationCategory(lang, "morphology", lang.calibrationText.morphologyLow));
  } else if (focus === "morphology") {
    const pct = Math.round(v.morphology.rate * 100);
    lines.push(calibrationCategory(lang, "morphology", lang.calibrationText.morphologyFocus(pct)));
  } else {
    lines.push(calibrationCategory(lang, "morphology", lang.calibrationText.morphologyNormal));
  }

  if (v.idiomaticity.confidence === "low") {
    lines.push(calibrationCategory(lang, "idiomaticity", lang.calibrationText.idiomaticityLow));
  } else if (focus === "idiomaticity") {
    const pct = Math.round(v.idiomaticity.rate * 100);
    lines.push(calibrationCategory(lang, "idiomaticity", lang.calibrationText.idiomaticityFocus(pct)));
  } else {
    lines.push(calibrationCategory(lang, "idiomaticity", lang.calibrationText.idiomaticityNormal));
  }

  if (v.reception.confidence !== "low") {
    if (v.reception.level > 0.75) {
      lines.push(calibrationReception(lang, Math.round(v.reception.level * 100), "raise"));
    } else if (v.reception.level < 0.35) {
      lines.push(calibrationReception(lang, Math.round(v.reception.level * 100), "lower"));
    }
  }

  if (v.monitoring.selfCorrectionObs > 0) {
    lines.push(calibrationSelfCorrection(lang, v.monitoring.selfCorrectionObs));
  }

  return lines.join("\n");
}

function calibrationHeader(_lang: LanguageConfig): string {
  return "## Calibración de dificultad";
}

function calibrationLine(_lang: LanguageConfig, key: "lexiconLow" | "lexiconFocus" | "syntaxLow"): string {
  const lines = {
    lexiconLow: "Vocabulario: usa vocabulario natural y variado, adecuado para una persona en desarrollo.",
    lexiconFocus: "Vocabulario: introduce aproximadamente una palabra de frecuencia media (rango 3.000-8.000) por turno, integrada de forma natural; no te quedes solo en la banda de las 1.000 más frecuentes.",
    syntaxLow: "Sintaxis: usa frases claras, mayormente simples.",
  } as const;
  return lines[key];
}

function calibrationLexiconMatch(_lang: LanguageConfig, rarity: number): string {
  const label = rarity > 0.6 ? "sofisticado" : rarity > 0.3 ? "de frecuencia media" : "común";
  return `Vocabulario: el aprendiz usa lenguaje ${label}; responde con complejidad similar o ligeramente superior (señal de rareza léxica: ${rarity.toFixed(2)}).`;
}

function calibrationSyntaxFocus(_lang: LanguageConfig, meanTunitLength: number, subIndex: number): string {
  const pct = Math.round(subIndex * 100);
  return `Sintaxis: modela frases complejas; incluye subordinadas (que + cláusula, frases con si, relativas); tu salida debe estar un paso por encima de la producción actual del aprendiz (${meanTunitLength.toFixed(1)} T-units de media, ${pct}% con subordinación).`;
}

function calibrationSyntaxNormal(_lang: LanguageConfig, meanTunitLength: number): string {
  const label = meanTunitLength < 3 ? "simples" : meanTunitLength < 6 ? "moderadas" : "variadas";
  return `Sintaxis: usa estructuras ${label}; incluye alguna subordinada ocasional.`;
}

function calibrationCategory(_lang: LanguageConfig, category: "morphology" | "idiomaticity", text: string): string {
  return `${category === "morphology" ? "Morfología" : "Idiomaticidad"}: ${text}`;
}

function calibrationReception(_lang: LanguageConfig, pct: number, direction: "raise" | "lower"): string {
  return direction === "raise"
    ? `Comprensión: ${pct}% fluida — sube un paso la complejidad de tu propia salida.`
    : `Comprensión: ${pct}% fluida — simplifica tu salida; frases más cortas y vocabulario más común.`;
}

function calibrationSelfCorrection(_lang: LanguageConfig, obs: number): string {
  return `Autocorrección: el aprendiz monitoriza activamente su habla (${obs} observaciones); respeta sus autocorrecciones y céntrate en feedback estilístico de nivel más alto.`;
}

export function formatVectorForDisplay(v: CompetencyVector): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const conf = (c: string) => (c === "low" ? " (forming)" : "");

  const byFrequencyBand = Object.entries(v.reception.byFrequencyBand)
    .filter(([, b]) => b.score !== null)
    .map(([band, b]) => `${band} ${pct(b.score ?? 0)}${conf(b.confidence)}`)
    .join(", ") || "not enough frequency-band evidence";

  return [
    `Lexicon: ${v.lexicon.activeChunks} chunks, rarity ${v.lexicon.lexicalRarity.toFixed(2)}${conf(v.lexicon.confidence)}`,
    `Syntax: T-units ${v.syntax.meanTunitLength.toFixed(1)}, subordination ${pct(v.syntax.subIndex)}${conf(v.syntax.confidence)}`,
    `Morphology: ${pct(v.morphology.rate)} accuracy${conf(v.morphology.confidence)}`,
    `Idiomaticity: ${pct(v.idiomaticity.rate)} naturalness${conf(v.idiomaticity.confidence)}`,
    `Reception: ${pct(v.reception.level)} smooth${conf(v.reception.confidence)}; by frequency: ${byFrequencyBand}`,
    `Self-Correction: ${v.monitoring.selfCorrectionObs} obs`,
  ].join(" | ");
}
