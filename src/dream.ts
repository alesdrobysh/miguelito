import fs from "fs";
import path from "path";
import { BuddyDb, TurnAnnotation } from "./db.js";
import { Config } from "./config.js";
import { llmChat } from "./llm.js";

const DREAM_SYSTEM_PROMPT = `You are Miguelito, a Spanish tutor. You have just finished your conversations for the day.
Update the learner's long-term memory profile by merging today's observations into the existing profile.

Rules:
1. Deduplicate — if a fact already appears, reinforce or refine rather than repeat it.
2. Update stale facts when new information contradicts them.
3. Keep the output ≤400 words total.
4. Write in compact, factual prose — no headers, no bullet points.
5. If today added nothing new, return the existing profile unchanged.

Focus on: vocabulary progress, persistent error patterns, strengths, topics of interest,
effective teaching approaches, and learner personality/preferences.`;

export async function runDream(config: Config, db: BuddyDb): Promise<string> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const messages = await db.getTodaysMessages(today);

  if (messages.length === 0) {
    return "Nothing to dream about today.";
  }

  const transcript = messages
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n");

  const memoryDir = path.dirname(config.dreamMemoryPath);
  fs.mkdirSync(memoryDir, { recursive: true });

  const existingMemory = fs.existsSync(config.dreamMemoryPath)
    ? fs.readFileSync(config.dreamMemoryPath, "utf8").trim()
    : "";

  const userPrompt = `Existing profile:\n${existingMemory || "(empty)"}\n\nToday's transcript:\n${transcript}`;

  const result = await llmChat(
    {
      apiKey: config.openrouterApiKey,
      model: config.openrouterModel,
      baseUrl: config.openrouterBaseUrl,
    },
    [
      { role: "system", content: DREAM_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    undefined,
    0.3,
    2048,
  );

  const updated = result.content?.trim();
  if (!updated) {
    return "Dream produced no output.";
  }

  fs.writeFileSync(config.dreamMemoryPath, updated, "utf8");

  // Phase 4: nightly vector refinement and avoidance/consolidation pass
  const refinementNotes = await runNightlyRefinement(db, updated);

  if (refinementNotes.length > 0) {
    const augmented = updated + "\n\n" + refinementNotes.join("\n");
    fs.writeFileSync(config.dreamMemoryPath, augmented, "utf8");
    return `Dream complete. Memory updated (${augmented.split(/\s+/).length} words). Refinement: ${refinementNotes.join("; ")}`;
  }

  return `Dream complete. Memory updated (${updated.split(/\s+/).length} words).`;
}

async function runNightlyRefinement(db: BuddyDb, currentMemory: string): Promise<string[]> {
  const notes: string[] = [];

  // 1. Avoidance detection: constructions that appear in obligatory_json
  //    but never in used_json over the last 30 days.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    .toISOString().slice(0, 19).replace("T", " ");
  const recentAnnotations = await db.getRecentAnnotations(500);

  const obligatoryCounts = new Map<string, number>();
  const usedSet = new Set<string>();

  for (const ann of recentAnnotations) {
    try {
      const obligatory: Array<{ type: string }> = JSON.parse(ann.obligatory_json);
      for (const o of obligatory) {
        obligatoryCounts.set(o.type, (obligatoryCounts.get(o.type) ?? 0) + 1);
      }
    } catch {}
    try {
      const used: string[] = JSON.parse(ann.used_json);
      for (const u of used) usedSet.add(u.toLowerCase());
    } catch {}
  }

  const avoidedConstructions: string[] = [];
  for (const [construction, count] of obligatoryCounts.entries()) {
    if (count >= 5 && !usedSet.has(construction.toLowerCase())) {
      avoidedConstructions.push(`${construction} (required ${count}× but never self-initiated)`);
    }
  }
  if (avoidedConstructions.length > 0) {
    notes.push(`Avoidance pattern: ${avoidedConstructions.join(", ")}.`);
  }

  // 2. Error consolidation: categories with zero errors in last 14 days
  //    but ≥5 obligatory contexts (evidence of mastery, not just avoidance).
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000)
    .toISOString().slice(0, 19).replace("T", " ");
  const recentErrors = await db.listRecentErrors(fourteenDaysAgo);
  const recentErrorCategories = new Set(recentErrors.map((e) => e.category));

  const MORPHOLOGY_TYPES = new Set(["verb_conjugation", "agreement", "ser_estar", "gender"]);
  for (const [type, count] of obligatoryCounts.entries()) {
    if (MORPHOLOGY_TYPES.has(type) && count >= 5 && !recentErrorCategories.has(type)) {
      notes.push(`${type} appears stable — no errors in the last 14 days with ${count} obligatory contexts.`);
    }
  }

  // 3. Vector recalibration: if morph_obs > 50 and morph_trials has decayed too
  //    far (stale from a long idle period), reset to preserve the rate with fresh weight.
  const vec = await db.getCompetencyVector();
  if (vec.morph_obs > 50 && vec.morph_trials < 0.05 && vec.morph_trials > 0) {
    const rate = vec.morph_successes / vec.morph_trials;
    await db.updateCompetencyVector({
      morph_successes: rate * 2,
      morph_trials: 2,
    });
    notes.push("Morphology EWMA recalibrated after idle period.");
  }
  if (vec.idiom_obs > 50 && vec.idiom_trials < 0.05 && vec.idiom_trials > 0) {
    const rate = vec.idiom_successes / vec.idiom_trials;
    await db.updateCompetencyVector({
      idiom_successes: rate * 2,
      idiom_trials: 2,
    });
    notes.push("Idiomaticity EWMA recalibrated after idle period.");
  }

  return notes;
}
