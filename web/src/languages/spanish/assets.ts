import frequencyRaw from '../../../../src/languages/spanish/frequency.txt?raw'
import cefrRaw from '../../../../src/languages/spanish/cefr.tsv?raw'
import soulContent from './soul.md?raw'
import type { CefrLevel } from '../../../../src/domain/frequency.js'

const VALID_LEVELS = new Set<CefrLevel>(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])

// Return type is inferred — do NOT import FrequencyData from assets.ts,
// that path is Vite-aliased back to this file (circular).
export function loadFrequency() {
  const topWords = frequencyRaw.split(/\s+/).filter(Boolean)

  const cefrLevels = new Map<string, CefrLevel>()
  for (const line of cefrRaw.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const word = line.slice(0, tab).trim()
    const level = line.slice(tab + 1).trim() as CefrLevel
    if (word && VALID_LEVELS.has(level)) cefrLevels.set(word, level)
  }

  return { topWords, lemmatize: (w: string) => w, cefrLevels }
}

export function loadSoulContent(): string {
  return soulContent
}
