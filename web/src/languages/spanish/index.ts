import type { LanguageConfig } from '../../../../src/languages/LanguageConfig.js'
import { spanishBaseConfig, FREQUENCY_SOURCE } from '../../../../src/languages/spanish/config.js'
import { loadFrequency } from './assets'

export const SpanishLanguage: LanguageConfig = {
  ...spanishBaseConfig,
  frequency: {
    source: FREQUENCY_SOURCE,
    ...loadFrequency(),
  },
  soulPath: '/virtual/soul.md',
}
