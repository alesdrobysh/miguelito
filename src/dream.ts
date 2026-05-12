import fs from "fs";
import path from "path";
import { BuddyDb } from "./db.js";
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
effective teaching approaches, CEFR-level evidence, and learner personality/preferences.`;

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
  return `Dream complete. Memory updated (${updated.split(/\s+/).length} words).`;
}
