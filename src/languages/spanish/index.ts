import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";
import { loadFrequency } from "./assets.js";
import { spanishBaseConfig, FREQUENCY_SOURCE } from "./config.js";

const _dir: string = typeof __dirname !== "undefined" ? __dirname : "";

export const SpanishLanguage: LanguageConfig = {
  ...spanishBaseConfig,
  frequency: {
    source: FREQUENCY_SOURCE,
    ...loadFrequency(),
  },
  soulPath: path.resolve(_dir, "soul.md"),
};
