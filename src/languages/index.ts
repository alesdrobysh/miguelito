import type { LanguageConfig } from "./LanguageConfig.js";
import { SpanishLanguage } from "./spanish/index.js";
import { PolishLanguage } from "./polish/index.js";
import { BelarusianLanguage } from "./belarusian/index.js";

export { SpanishLanguage, PolishLanguage, BelarusianLanguage };

export function loadLanguage(id: string): LanguageConfig {
  switch (id) {
    case "spanish": return SpanishLanguage;
    case "polish": return PolishLanguage;
    case "belarusian": return BelarusianLanguage;
    default:
      throw new Error(`Unknown language: "${id}". Supported: spanish, polish, belarusian`);
  }
}
