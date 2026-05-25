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
    byLevel: Record<string, { score: number | null; obs: number; confidence: Confidence }>;
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

async function buildReceptionByLevel(repo: CompetencyRepository): Promise<Record<string, { score: number | null; obs: number; confidence: Confidence }>> {
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const result: Record<string, { score: number | null; obs: number; confidence: Confidence }> = {};
  for (const level of levels) result[level] = { score: null, obs: 0, confidence: "low" };

  const rows = await repo.listProficiencyEvidence(200);
  const outcomeScore: Record<string, number> = { success: 1, partial: 0.5, fail: 0 };
  for (const level of levels) {
    const bucket = rows.filter((r) => r.skill === "reception" && r.dimension === "lexical" && r.level === level);
    const denom = bucket.reduce((s, r) => s + Math.max(0, r.weight) * Math.max(0, Math.min(1, r.confidence)), 0);
    if (denom <= 0) continue;
    const score = bucket.reduce((s, r) => s + (outcomeScore[r.outcome] ?? 0.5) * Math.max(0, r.weight) * Math.max(0, Math.min(1, r.confidence)), 0) / denom;
    result[level] = { score, obs: bucket.length, confidence: obsToConfidence(bucket.length) };
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
  const receptionByLevel = await buildReceptionByLevel(repos.competency);

  return {
    lexicon: { activeChunks, lexicalRarity: vec.lexical_rarity_ewma, confidence: lexiconConf },
    syntax: { meanTunitLength, subIndex, confidence: obsToConfidence(n) },
    morphology: { rate: morphRate, obs: vec.morph_obs, confidence: obsToConfidence(vec.morph_obs) },
    idiomaticity: { rate: idiomRate, obs: vec.idiom_obs, confidence: obsToConfidence(vec.idiom_obs) },
    reception: { level: vec.reception_ewma, obs: vec.reception_obs, confidence: obsToConfidence(vec.reception_obs), byLevel: receptionByLevel },
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

function calibrationHeader(lang: LanguageConfig): string {
  if (lang.id === "spanish") return "## Calibración de dificultad";
  if (lang.id === "polish") return "## Kalibracja trudności";
  return "## Каліброўка складанасці";
}

function calibrationLine(lang: LanguageConfig, key: "lexiconLow" | "lexiconFocus" | "syntaxLow"): string {
  const byLang = {
    spanish: {
      lexiconLow: "Vocabulario: usa vocabulario natural y variado, adecuado para una persona en desarrollo.",
      lexiconFocus: "Vocabulario: introduce aproximadamente una palabra de frecuencia media (rango 3.000-8.000) por turno, integrada de forma natural; no te quedes solo en la banda de las 1.000 más frecuentes.",
      syntaxLow: "Sintaxis: usa frases claras, mayormente simples.",
    },
    polish: {
      lexiconLow: "Słownictwo: używaj naturalnego, zróżnicowanego słownictwa odpowiedniego dla rozwijającego się ucznia.",
      lexiconFocus: "Słownictwo: wprowadzaj około jedno słowo średniej częstotliwości (zakres 3 000-8 000) na turę, naturalnie wplecione w kontekst; nie zostawaj wyłącznie w paśmie 1 000 najczęstszych słów.",
      syntaxLow: "Składnia: używaj jasnych, przeważnie prostych zdań.",
    },
    belarusian: {
      lexiconLow: "Лексіка: выкарыстоўвай натуральную, разнастайную лексіку, прыдатную для навучэнца ў развіцці.",
      lexiconFocus: "Лексіка: уводзь прыкладна адно слова сярэдняй частотнасці (дыяпазон 3 000-8 000) за ход, натуральна ўплеценае ў кантэкст; не заставайся толькі ў зоне 1 000 найчасцейшых слоў.",
      syntaxLow: "Сінтаксіс: выкарыстоўвай ясныя, пераважна простыя сказы.",
    },
  } as const;
  return byLang[lang.id as keyof typeof byLang][key];
}

function calibrationLexiconMatch(lang: LanguageConfig, rarity: number): string {
  if (lang.id === "spanish") {
    const label = rarity > 0.6 ? "sofisticado" : rarity > 0.3 ? "de frecuencia media" : "común";
    return `Vocabulario: el aprendiz usa lenguaje ${label}; responde con complejidad similar o ligeramente superior (señal de rareza léxica: ${rarity.toFixed(2)}).`;
  }
  if (lang.id === "polish") {
    const label = rarity > 0.6 ? "wyrafinowanego" : rarity > 0.3 ? "średniej częstotliwości" : "częstego";
    return `Słownictwo: uczeń używa języka ${label}; odpowiadaj podobną albo nieco wyższą złożonością (sygnał rzadkości leksykalnej: ${rarity.toFixed(2)}).`;
  }
  const label = rarity > 0.6 ? "вытанчаную" : rarity > 0.3 ? "сярэдняй частотнасці" : "звычайную";
  return `Лексіка: навучэнец выкарыстоўвае ${label} мову; адказвай з падобнай або крыху вышэйшай складанасцю (сігнал лексічнай рэдкасці: ${rarity.toFixed(2)}).`;
}

function calibrationSyntaxFocus(lang: LanguageConfig, meanTunitLength: number, subIndex: number): string {
  const pct = Math.round(subIndex * 100);
  if (lang.id === "spanish") return `Sintaxis: modela frases complejas; incluye subordinadas (que + cláusula, frases con si, relativas); tu salida debe estar un paso por encima de la producción actual del aprendiz (${meanTunitLength.toFixed(1)} T-units de media, ${pct}% con subordinación).`;
  if (lang.id === "polish") return `Składnia: modeluj zdania złożone; używaj zdań podrzędnych, warunkowych i względnych; twoja wypowiedź powinna być o krok powyżej bieżącej produkcji ucznia (${meanTunitLength.toFixed(1)} T-unit średnio, ${pct}% z podrzędnością).`;
  return `Сінтаксіс: мадэлюй складаныя сказы; уключай даданыя, умоўныя і адносныя канструкцыі; твой вывад павінен быць на адзін крок вышэй за бягучую прадукцыю навучэнца (${meanTunitLength.toFixed(1)} T-units у сярэднім, ${pct}% з падпарадкаваннем).`;
}

function calibrationSyntaxNormal(lang: LanguageConfig, meanTunitLength: number): string {
  if (lang.id === "spanish") {
    const label = meanTunitLength < 3 ? "simples" : meanTunitLength < 6 ? "moderadas" : "variadas";
    return `Sintaxis: usa estructuras ${label}; incluye alguna subordinada ocasional.`;
  }
  if (lang.id === "polish") {
    const label = meanTunitLength < 3 ? "proste" : meanTunitLength < 6 ? "umiarkowane" : "zróżnicowane";
    return `Składnia: używaj ${label} struktur zdań; czasem dodaj zdanie podrzędne.`;
  }
  const label = meanTunitLength < 3 ? "простыя" : meanTunitLength < 6 ? "умераныя" : "разнастайныя";
  return `Сінтаксіс: выкарыстоўвай ${label} структуры сказаў; часам уключай даданы сказ.`;
}

function calibrationCategory(lang: LanguageConfig, category: "morphology" | "idiomaticity", text: string): string {
  if (lang.id === "spanish") return `${category === "morphology" ? "Morfología" : "Idiomaticidad"}: ${text}`;
  if (lang.id === "polish") return `${category === "morphology" ? "Morfologia" : "Idiomatyczność"}: ${text}`;
  return `${category === "morphology" ? "Марфалогія" : "Ідыяматычнасць"}: ${text}`;
}

function calibrationReception(lang: LanguageConfig, pct: number, direction: "raise" | "lower"): string {
  if (lang.id === "spanish") return direction === "raise"
    ? `Comprensión: ${pct}% fluida — sube un paso la complejidad de tu propia salida.`
    : `Comprensión: ${pct}% fluida — simplifica tu salida; frases más cortas y vocabulario más común.`;
  if (lang.id === "polish") return direction === "raise"
    ? `Recepcja: ${pct}% płynnie — podnieś złożoność własnej wypowiedzi o jeden krok.`
    : `Recepcja: ${pct}% płynnie — uprość własną wypowiedź; krótsze zdania i częstsze słownictwo.`;
  return direction === "raise"
    ? `Успрыманне: ${pct}% гладка — павяліч складанасць свайго вываду на адзін крок.`
    : `Успрыманне: ${pct}% гладка — спрасці свой вывад; карацейшыя сказы і больш частая лексіка.`;
}

function calibrationSelfCorrection(lang: LanguageConfig, obs: number): string {
  if (lang.id === "spanish") return `Autocorrección: el aprendiz monitoriza activamente su habla (${obs} observaciones); respeta sus autocorrecciones y céntrate en feedback estilístico de nivel más alto.`;
  if (lang.id === "polish") return `Autokorekta: uczeń aktywnie monitoruje swoją mowę (${obs} obserwacji); szanuj autokorekty i skupiaj się na wyższopoziomowej informacji stylistycznej.`;
  return `Самавыпраўленне: навучэнец актыўна кантралюе маўленне (${obs} назіранняў); паважай самавыпраўленні і засяроджвайся на стылістычнай зваротнай сувязі вышэйшага ўзроўню.`;
}

export function formatVectorForDisplay(v: CompetencyVector): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const conf = (c: string) => (c === "low" ? " (forming)" : "");

  const byLevel = Object.entries(v.reception.byLevel)
    .filter(([, b]) => b.score !== null)
    .map(([level, b]) => `${level} ${pct(b.score ?? 0)}${conf(b.confidence)}`)
    .join(", ") || "not enough leveled evidence";

  return [
    `Lexicon: ${v.lexicon.activeChunks} chunks, rarity ${v.lexicon.lexicalRarity.toFixed(2)}${conf(v.lexicon.confidence)}`,
    `Syntax: T-units ${v.syntax.meanTunitLength.toFixed(1)}, subordination ${pct(v.syntax.subIndex)}${conf(v.syntax.confidence)}`,
    `Morphology: ${pct(v.morphology.rate)} accuracy${conf(v.morphology.confidence)}`,
    `Idiomaticity: ${pct(v.idiomaticity.rate)} naturalness${conf(v.idiomaticity.confidence)}`,
    `Reception: ${pct(v.reception.level)} smooth${conf(v.reception.confidence)}; by level: ${byLevel}`,
    `Self-Correction: ${v.monitoring.selfCorrectionObs} obs`,
  ].join(" | ");
}
