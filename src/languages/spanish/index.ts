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
  calibrationThresholds: { morphology: 0.75, idiomaticity: 0.70 },
  calibrationText: {
    morphologyLow: "",
    morphologyFocus: (_pct) => "",
    morphologyNormal: "",
    idiomaticityLow: "",
    idiomaticityFocus: (_pct) => "",
    idiomaticityNormal: "",
  },
  prompts: {
    morning: "",
    evening: "",
    dream: "",
    readLink: (_title, _text) => "",
    readingSuggest: (_title, _text) => "",
  },
  soulPath: path.resolve(__dirname, "soul.md"),
};
