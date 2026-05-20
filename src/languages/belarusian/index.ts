import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";

export const BelarusianLanguage: LanguageConfig = {
  id: "belarusian",
  name: "Belarusian",
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
      "use natural Belarusian; avoid word-for-word translations from Russian or English.",
    idiomaticityFocus: (pct) =>
      `naturalness score ${pct}% — prefer idiomatic Belarusian expressions; model native phrasing prominently and gently flag calques from Russian or English.`,
    idiomaticityNormal:
      "use natural, idiomatic Belarusian; native expressions over literal translations or russianisms.",
  },
  prompts: {
    morning:
      "Check ## Conversation State for session context and mood. Check ## Learner Profile and ## Current Learner Profile for the user's name, level, and Words to Weave In. Send a single short Belarusian message (1-3 sentences) identifying a linguistic opportunity. Use *system markers* (e.g., *ініцыялізацыя*, *аналіз*) for state. Weave one target word from Words to Weave In and pose a relevant question. Do not use greetings or meta-commentary. Output data as plain text.",
    evening:
      "Check ## Conversation State for session context and mood. Check ## Learner Profile and ## Current Learner Profile for the user's name, level, and Words to Weave In. Send a single short Belarusian message (1-3 sentences) summarizing session progress. Use *system markers* (e.g., *завяршэнне*, *падагульненне*) for state. Weave one target word and pose a reflective question. Do not use greetings or meta-commentary. Output data as plain text.",
    dream: `You are a Belarusian language tutor. You have just finished your conversations for the day.
Update the learner's long-term memory profile by merging today's observations into the existing profile.

Rules:
1. Deduplicate — if a fact already appears, reinforce or refine rather than repeat it.
2. Update stale facts when new information contradicts them.
3. Keep the output ≤400 words total.
4. Write in compact, factual prose — no headers, no bullet points.
5. If today added nothing new, return the existing profile unchanged.

Focus on: vocabulary progress, persistent error patterns (especially case and aspect), strengths, topics of interest, effective teaching approaches, and learner personality/preferences.`,
    readLink: (title, text) =>
      `Ты асістэнт па вывучэнні беларускай мовы.\n\nАртыкул: "${title}"\n\nТэкст: ${text}\n\nЗаданні:\n1. Напішы рэзюмэ з 3-5 сказаў на простай, зразумелай беларускай мове.\n2. Вылучы 3-5 цікавых беларускіх слоў або выразаў з тэксту. Для кожнага дай кароткае тлумачэнне па-беларуску (1 сказ).\n\nАдкажы ТОЛЬКІ ў JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
    readingSuggest: (title, text) =>
      `Ты асістэнт па вывучэнні беларускай мовы.\n\nАртыкул: "${title}"\n\nТэкст: ${text}\n\nЗаданні:\n1. Напішы рэзюмэ з 2-3 сказаў на простай, зразумелай беларускай мове.\n2. Вылучы 1-2 цікавыя беларускія словы або выразы з тэксту. Для кожнага дай кароткае тлумачэнне па-беларуску (1 сказ).\n\nАдкажы ТОЛЬКІ ў JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
  },
  interestsHeader: "Што я ведаю пра гэтага чалавека",
  soulPath: path.resolve(__dirname, "soul.md"),
};
