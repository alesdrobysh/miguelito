import fs from "fs";
import path from "path";
import type { CefrLevel } from "../../domain/frequency.js";

const VALID_LEVELS = new Set<CefrLevel>(["A1", "A2", "B1", "B2", "C1", "C2"]);
let cache: ReadonlyMap<string, CefrLevel> | null = null;

// Load PCIC (Instituto Cervantes) CEFR level assignments for Spanish words.
// Format: word<TAB>level (A1…C2), one per line.
export function loadCefrLevels(): ReadonlyMap<string, CefrLevel> {
  if (cache) return cache;
  const filePath = path.join(__dirname, "cefr.tsv");
  const map = new Map<string, CefrLevel>();
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const word = line.slice(0, tab).trim();
    const level = line.slice(tab + 1).trim() as CefrLevel;
    if (word && VALID_LEVELS.has(level)) map.set(word, level);
  }
  cache = map;
  return map;
}
