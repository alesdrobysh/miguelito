import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface Config {
  transport: "telegram" | "tui";
  telegramToken: string;
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  dbPath: string;
  allowedUsers: Set<string>;
  morningCron: string;
  eveningCron: string;
  timezone: string;
  telegramChatId: string;
  soulPath: string;
  morningCronPrompt: string;
  eveningCronPrompt: string;
  dreamCron: string;
  dreamMemoryPath: string;
}

export function loadConfig(): Config {
  const transport = (process.env.TRANSPORT ?? "telegram") as Config["transport"];
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const openrouterApiKey = process.env.OPENROUTER_API_KEY ?? "";
  const openrouterModel = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-lite";
  const openrouterBaseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const dbPath = process.env.DB_PATH ?? "./data/buddy.db";
  const allowedUsers = new Set(
    (process.env.ALLOWED_USERS ?? "").split(",").filter(Boolean)
  );
  const morningCron = process.env.MORNING_CRON ?? "0 9 * * *";
  const eveningCron = process.env.EVENING_CRON ?? "30 19 * * *";
  const timezone = process.env.TIMEZONE ?? "Europe/Warsaw";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? "";

  if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is required");
  if (transport === "telegram") {
    if (!telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is required when TRANSPORT=telegram");
    if (!telegramChatId) throw new Error("TELEGRAM_CHAT_ID is required when TRANSPORT=telegram");
  }

  const soulPath = process.env.SOUL_PATH ?? path.resolve(process.cwd(), "SOUL.md");
  const morningCronPrompt = process.env.MORNING_CRON_PROMPT ?? "Check ## Conversation State for session context and mood. Check ## Learner Profile and ## Current Learner Profile for the user's name, level, and Words to Weave In. Send a single short Spanish message (1-3 sentences). If Words to Weave In are listed, weave one naturally and end with a hook. If none, open with a brief curiosity-driven question about the user's day or a tiny cultural snippet. Never start with your name. Never paste raw data.";
  const eveningCronPrompt = process.env.EVENING_CRON_PROMPT ?? "Check ## Conversation State for session context and mood. Check ## Current Learner Profile for Weak Areas and Error to Reinforce. If an error pattern is present, ask a small question that touches it. If not, ask what the user did today in one sentence. End with a hook.";
  const dreamCron = process.env.DREAM_CRON ?? "0 23 * * *";
  const dreamMemoryPath = process.env.DREAM_MEMORY_PATH ?? path.resolve(process.cwd(), "data/memory/MEMORY.md");

  return {
    transport,
    telegramToken,
    openrouterApiKey,
    openrouterModel,
    openrouterBaseUrl,
    dbPath,
    allowedUsers,
    morningCron,
    eveningCron,
    timezone,
    telegramChatId,
    soulPath,
    morningCronPrompt,
    eveningCronPrompt,
    dreamCron,
    dreamMemoryPath,
  };
}
