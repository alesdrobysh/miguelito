import fs from "fs";
import path from "path";
import { lemmatize } from "./lemmatize.js";

export interface FrequencyData {
  topWords: readonly string[];
  lemmatize: (word: string) => string;
}

// `__dirname` is not defined in browser ESM. Guard so the canonical index.ts
// degrades gracefully when loaded via runtime.ts in browser context.
// The browser `web/src/languages/spanish/index.ts` wrapper overrides with ?raw data.
const _dir: string = typeof __dirname !== "undefined" ? __dirname : "";

export function loadFrequency(): FrequencyData {
  return {
    topWords: fs.readFileSync(path.join(_dir, "frequency.txt"), "utf8").split(/\s+/).filter(Boolean),
    lemmatize,
  };
}

export function loadSoulContent(): string {
  return fs.readFileSync(path.join(_dir, "soul.md"), "utf8");
}
