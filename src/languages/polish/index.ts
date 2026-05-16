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
