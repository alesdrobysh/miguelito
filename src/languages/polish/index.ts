import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";

export const PolishLanguage: LanguageConfig = {
  id: "polish",
  name: "Polish",
  errorCategories: [
    "case", "aspect", "gender", "agreement",
    "preposition", "spelling", "word_choice", "word_order", "other",
  ],
  morphologyCategories: ["case", "aspect", "gender", "agreement"],
  calibrationThresholds: {
    morphology: 0.75,
    idiomaticity: 0.70,
  },
  calibrationText: {
    morphologyLow:
      "use common forms freely; introduce case variation as it arises naturally.",
    morphologyFocus: (pct) =>
      `learner accuracy ${pct}% on obligatory contexts — model correct case endings, aspect selection, and agreement prominently; use contrasting aspect pairs to expose the patterns.`,
    morphologyNormal:
      "use nominative, accusative, and genitive cases freely; introduce instrumental and locative contextually.",
    idiomaticityLow:
      "use natural Polish; avoid word-for-word translations from English.",
    idiomaticityFocus: (pct) =>
      `naturalness score ${pct}% — prefer idiomatic expressions; model native phrasing prominently and gently flag calques from English.`,
    idiomaticityNormal:
      "use natural, idiomatic Polish; native expressions over literal translations.",
  },
  prompts: {
    morning:
      "Check ## Conversation State for session context and mood. Check ## Learner Profile and ## Current Learner Profile for the user's name, level, and Words to Weave In. Send a single short Polish message (1-3 sentences) identifying a linguistic opportunity. Use *system markers* (e.g., *inicjalizacja*, *analiza*) for state. Weave one target word from Words to Weave In and pose a relevant question. Do not use greetings or meta-commentary. Output data as plain text.",
    evening:
      "Check ## Conversation State for session context and mood. Check ## Learner Profile and ## Current Learner Profile for the user's name, level, and Words to Weave In. Send a single short Polish message (1-3 sentences) summarizing session progress. Use *system markers* (e.g., *zamykanie*, *podsumowanie*) for state. Weave one target word and pose a reflective question. Do not use greetings or meta-commentary. Output data as plain text.",
    dream: `You are a Polish language tutor. You have just finished your conversations for the day.
Update the learner's long-term memory profile by merging today's observations into the existing profile.

Rules:
1. Deduplicate — if a fact already appears, reinforce or refine rather than repeat it.
2. Update stale facts when new information contradicts them.
3. Keep the output ≤400 words total.
4. Write in compact, factual prose — no headers, no bullet points.
5. If today added nothing new, return the existing profile unchanged.

Focus on: vocabulary progress, persistent error patterns (especially case and aspect), strengths, topics of interest, effective teaching approaches, and learner personality/preferences.`,
    readLink: (title, text) =>
      `Jesteś asystentem nauki języka polskiego.\n\nArtykuł: "${title}"\n\nTekst: ${text}\n\nZadania:\n1. Napisz streszczenie 3-5 zdaniami w prostym, przystępnym języku polskim.\n2. Wyodrębnij 3-5 ciekawych polskich słów lub wyrażeń z tekstu. Dla każdego podaj krótkie wyjaśnienie po polsku (1 zdanie).\n\nOdpowiedz TYLKO w JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
    readingSuggest: (title, text) =>
      `Jesteś asystentem nauki języka polskiego.\n\nArtykuł: "${title}"\n\nTekst: ${text}\n\nZadania:\n1. Napisz streszczenie 2-3 zdaniami w prostym, przystępnym języku polskim.\n2. Wyodrębnij 1-2 ciekawe polskie słowa lub wyrażenia z tekstu. Dla każdego podaj krótkie wyjaśnienie po polsku (1 zdanie).\n\nOdpowiedz TYLKO w JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
  },
  soulPath: path.resolve(__dirname, "soul.md"),
};
