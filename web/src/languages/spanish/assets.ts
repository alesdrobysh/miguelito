import frequencyRaw from '../../../../src/languages/spanish/frequency.txt?raw'
import soulContent from './soul.md?raw'

export function loadFrequency() {
  return {
    topWords: frequencyRaw.split(/\s+/).filter(Boolean),
    lemmatize: (w: string) => w,
  }
}

export function loadSoulContent(): string {
  return soulContent
}
