import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";

export const SpanishLanguage: LanguageConfig = {
  id: "spanish",
  name: "Spanish",
  errorCategories: [
    "gender", "verb_conjugation", "preposition", "spelling",
    "word_choice", "agreement", "ser_estar", "por_para", "other",
  ],
  morphologyCategories: ["verb_conjugation", "agreement", "ser_estar", "gender"],
  calibrationThresholds: {
    morphology: 0.75,
    idiomaticity: 0.70,
  },
  calibrationText: {
    morphologyLow:
      "use present tense and pretérito freely; introduce other tenses as they arise naturally.",
    morphologyFocus: (pct) =>
      `learner accuracy ${pct}% on obligatory contexts — model correct verb conjugation and agreement prominently; use imperfecto and subjunctive in contrastive situations to expose the patterns.`,
    morphologyNormal:
      "use present, pretérito, and imperfecto freely; introduce subjunctive contextually.",
    idiomaticityLow:
      "use natural Spanish; avoid literal translations.",
    idiomaticityFocus: (pct) =>
      `naturalness score ${pct}% — prefer idiomatic collocations; model native phrasing prominently and gently flag calques.`,
    idiomaticityNormal:
      "use natural, idiomatic Spanish; native collocations over literal translations.",
  },
  interestsHeader: "Lo que sé de esta persona",
  prompts: {
    morning:
      "Check ## Learner Profile for the user's name. Check ## Current Learner Profile for Words to Weave In. Send a single short Spanish message (1-3 sentences). If Words to Weave In are listed, weave one naturally and end with a hook. If none, open with a curiosity-driven question or cultural snippet. Never output mode names, system markers, or internal state. Only natural Spanish text.",
    evening:
      "Check ## Learner Profile for the user's name. Check ## Current Learner Profile for Words to Weave In. Send a single short Spanish message (1-3 sentences) with a reflective question. If Words to Weave In are listed, weave one naturally. Never output mode names, system markers, or internal state. Only natural Spanish text.",
    dream: `You are Miguelito, a Spanish tutor. You have just finished your conversations for the day.
Update the learner's long-term memory profile by merging today's observations into the existing profile.

Rules:
1. Deduplicate — if a fact already appears, reinforce or refine rather than repeat it.
2. Update stale facts when new information contradicts them.
3. Keep the output ≤400 words total.
4. Write in compact, factual prose — no headers, no bullet points.
5. If today added nothing new, return the existing profile unchanged.

Focus on: vocabulary progress, persistent error patterns, strengths, topics of interest,
effective teaching approaches, and learner personality/preferences.`,
    readLink: (title, text) =>
      `Eres un asistente de aprendizaje de español.\n\nArtículo: "${title}"\n\nTexto: ${text}\n\nTareas:\n1. Escribe un resumen de 3-5 frases en español claro y accesible.\n2. Extrae 3-5 palabras o expresiones españolas interesantes del texto. Para cada una, da una breve explicación en español (1 frase, no traducción).\n\nResponde SOLO con JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
    readingSuggest: (title, text) =>
      `Eres un asistente de aprendizaje de español.\n\nArtículo: "${title}"\n\nTexto: ${text}\n\nTareas:\n1. Escribe un resumen de 2-3 frases en español claro y accesible.\n2. Extrae 1-2 palabras o expresiones españolas interesantes del texto. Para cada una, da una breve explicación en español (1 frase, no traducción).\n\nResponde SOLO con JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
  },
  soulPath: path.resolve(__dirname, "soul.md"),
};
