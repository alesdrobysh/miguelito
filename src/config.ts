import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface Config {
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
}

export function loadConfig(): Config {
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

  if (!telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is required");
  if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is required");
  if (!telegramChatId) throw new Error("TELEGRAM_CHAT_ID is required");

  const soulPath = process.env.SOUL_PATH ?? path.resolve(process.cwd(), "SOUL.md");
  const morningCronPrompt = process.env.MORNING_CRON_PROMPT ?? "Check ## Conversation State for session context and mood. Then call miguelito_profile_get to check the user's name and level. Then send a single short Spanish message (1-3 sentences). Call miguelito_vocab_due to find a word whose review is due. If a word is returned, weave it naturally into the message and end with a hook. If no words are due, open with a brief curiosity-driven question about the user's day or a tiny cultural snippet. Never start with your name. Never paste tool output.";
  const eveningCronPrompt = process.env.EVENING_CRON_PROMPT ?? "Check ## Conversation State for session context and mood. Then call miguelito_error_list with category 'all' and limit 5 to find a recent weak spot. If you find a relevant pattern, ask a small question that touches it. If empty, ask what the user did today in one sentence. End with a hook.";

  return {
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
  };
}
