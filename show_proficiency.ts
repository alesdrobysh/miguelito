import { BuddyDb } from "./src/infrastructure/db.js";
import { loadLanguage } from "./src/languages/index.js";
import { getCompetencyVector, selectFocusAxis } from "./src/domain/competency.js";

async function showProficiency(langId: string, dbPath: string) {
  const langConfig = loadLanguage(langId);
  const db = await BuddyDb.open(
    dbPath,
    langId,
    langConfig.errorCategories,
    langConfig.morphologyCategories
  );

  const profile = await db.getProfile();
  const progress = await db.progressSummary();
  const v = await getCompetencyVector({ competency: db, vocab: db });
  const focus = selectFocusAxis(v, langConfig);

  console.log(`==================================================`);
  console.log(`  LANGUAGE: ${langConfig.name.toUpperCase()}`);
  console.log(`==================================================`);
  if (profile) {
    console.log(`Goal:              ${profile.goal || "None"}`);
    console.log(`Correction Style:  ${profile.correction_style || "None"}`);
  }
  console.log(`\n--- Vocabulary Summary ---`);
  console.log(`Total Chunks:      ${progress.totalCount}`);
  console.log(`  * New:           ${progress.newCount}`);
  console.log(`  * Learning:      ${progress.learningCount}`);
  console.log(`  * Review:        ${progress.reviewCount}`);
  console.log(`  * Mastered:      ${progress.masteredCount}`);
  console.log(`  * Due for review:${progress.dueCount}`);

  console.log(`\n--- Competency Vector ---`);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const conf = (c: string) => `(${c})`;
  console.log(`Lexicon:           ${v.lexicon.activeChunks} chunks, rarity ${v.lexicon.lexicalRarity.toFixed(2)} ${conf(v.lexicon.confidence)}`);
  console.log(`Syntax:            Mean T-unit length ${v.syntax.meanTunitLength.toFixed(1)}, Subordination ${pct(v.syntax.subIndex)} ${conf(v.syntax.confidence)}`);
  console.log(`Morphology:        Accuracy ${pct(v.morphology.rate)} (obs: ${v.morphology.obs}) ${conf(v.morphology.confidence)}`);
  console.log(`Idiomaticity:      Naturalness ${pct(v.idiomaticity.rate)} (obs: ${v.idiomaticity.obs}) ${conf(v.idiomaticity.confidence)}`);
  console.log(`Reception:         Smoothness ${pct(v.reception.level)} (obs: ${v.reception.obs}) ${conf(v.reception.confidence)}`);
  console.log(`Self-Correction:   Observations: ${v.monitoring.selfCorrectionObs}`);

  console.log(`\nFocus Axis:        ${focus ? focus.toUpperCase() : "NONE (Well Balanced)"}`);

  if (progress.recentWords && progress.recentWords.length > 0) {
    console.log(`\nRecent Words/Chunks:`);
    console.log(`  ${progress.recentWords.slice(0, 10).join(", ")}`);
  }

  if (progress.errorCategories && Object.keys(progress.errorCategories).length > 0) {
    console.log(`\nTop Error Categories:`);
    Object.entries(progress.errorCategories)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        console.log(`  * ${cat}: ${count}`);
      });
  }
  console.log("\n");
}

async function run() {
  await showProficiency("polish", "./data/buddy-polish.db");
  await showProficiency("spanish", "./data/buddy-spanish.db");
}

run().catch(console.error);
