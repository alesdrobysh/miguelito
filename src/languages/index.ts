import type { LanguageConfig } from "./LanguageConfig.js";
import { SpanishLanguage } from "./spanish/index.js";
import { PolishLanguage } from "./polish/index.js";

export { SpanishLanguage, PolishLanguage };

export function listAvailableLanguages(): LanguageConfig[] {
  return [SpanishLanguage, PolishLanguage];
}

export function loadLanguage(id: string): LanguageConfig {
  switch (id) {
    case "spanish": return SpanishLanguage;
    case "polish": return PolishLanguage;
    default:
      throw new Error(`Unknown language: "${id}". Supported: spanish, polish`);
  }
}
