import type { LanguageConfig } from "./LanguageConfig.js";
import { SpanishLanguage } from "./spanish/index.js";

export { SpanishLanguage };

const ACTIVE_LANGUAGES = [SpanishLanguage] as const;

export function listAvailableLanguages(): LanguageConfig[] {
  return [...ACTIVE_LANGUAGES];
}

export function loadLanguage(id: string): LanguageConfig {
  const language = ACTIVE_LANGUAGES.find((lang) => lang.id === id);
  if (language) return language;
  throw new Error(`Unknown language: "${id}". Supported: ${ACTIVE_LANGUAGES.map((lang) => lang.id).join(", ")}`);
}
