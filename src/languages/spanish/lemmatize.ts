import fs from "fs";
import path from "path";

// Spanish enclitic pronouns — try longest suffixes first to avoid partial matches
const CLITICS = [
  "selos", "selas", "melos", "melas", "telos", "telas",
  "nos", "los", "las", "les",
  "me", "te", "se", "lo", "la", "le", "os",
];

let lemmaMap: Map<string, string> | null = null;
const _dir: string = typeof __dirname !== "undefined" ? __dirname : "";

function getMap(): Map<string, string> {
  if (lemmaMap) return lemmaMap;
  // Format: lemma\tinflected_form (one pair per line, utf-8-sig BOM)
  const filePath = path.join(_dir, "lemmas.txt");
  const content = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  lemmaMap = new Map();
  for (const line of content.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const lemma = line.slice(0, tab).toLowerCase().trim();
    const inflected = line.slice(tab + 1).toLowerCase().trim();
    if (lemma && inflected) lemmaMap.set(inflected, lemma);
  }
  return lemmaMap;
}

const ACCENT_MAP: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };

function removeVowelAccents(s: string): string {
  return s.replace(/[áéíóú]/g, (c) => ACCENT_MAP[c] ?? c);
}

export function lemmatize(word: string): string {
  const map = getMap();

  // Step 1: direct dictionary lookup (handles sueles → soler, etc.)
  const direct = map.get(word);
  if (direct) return direct;

  // Step 2: strip enclitic pronoun(s) then try again
  // Spanish orthography adds an accent when attaching clitics shifts stress to
  // the antepenultimate syllable (e.g. corrige → corrígeme), so we also try
  // the accent-stripped form before giving up.
  for (const clitic of CLITICS) {
    if (word.length <= clitic.length + 1) continue;
    if (!word.endsWith(clitic)) continue;

    const stripped = word.slice(0, word.length - clitic.length);
    const deaccented = removeVowelAccents(stripped);
    // deaccented === stripped when no accent shift occurred — both lookups are harmless
    return map.get(stripped) ?? map.get(deaccented) ?? deaccented;
  }

  return word;
}
