import fs from "fs";
import path from "path";

export function loadFrequencyWords(language: "spanish" | "polish"): readonly string[] {
  const filePath = path.join(__dirname, `${language}.txt`);
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}
