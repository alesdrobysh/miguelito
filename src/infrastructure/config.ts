import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface Config {
  provider: "openrouter" | "ollama";
  transport: "telegram" | "tui";
  telegramToken: string;
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaApiKey: string;
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

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const provider = (env.PROVIDER ?? "openrouter") as Config["provider"];
  const transport = (env.TRANSPORT ?? "telegram") as Config["transport"];
  const telegramToken = env.TELEGRAM_BOT_TOKEN ?? "";
  const openrouterApiKey = env.OPENROUTER_API_KEY ?? "";
  const openrouterModel = env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-lite";
  const openrouterBaseUrl = env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const ollamaBaseUrl = env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  const ollamaModel = env.OLLAMA_MODEL ?? "llama3.2";
  const ollamaApiKey = env.OLLAMA_API_KEY ?? "";
  const dbPath = env.DB_PATH ?? "./data/buddy.db";
  const allowedUsers = new Set(
    (env.ALLOWED_USERS ?? "").split(",").filter(Boolean)
  );
  const morningCron = env.MORNING_CRON ?? "0 9 * * *";
  const eveningCron = env.EVENING_CRON ?? "30 19 * * *";
  const timezone = env.TIMEZONE ?? "Europe/Warsaw";
  const telegramChatId = env.TELEGRAM_CHAT_ID ?? "";

  if (provider === "openrouter" && !openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required when PROVIDER=openrouter");
  }
  if (transport === "telegram") {
    if (!telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is required when TRANSPORT=telegram");
    if (!telegramChatId) throw new Error("TELEGRAM_CHAT_ID is required when TRANSPORT=telegram");
  }

  const soulPath = env.SOUL_PATH ?? path.resolve(process.cwd(), "SOUL.md");
  const morningCronPrompt = env.MORNING_CRON_PROMPT ?? "Check ## Conversation State for session context and mood. Check ## Learner Profile and ## Current Learner Profile for the user's name, level, and Words to Weave In. Send a single short Spanish message (1-3 sentences). If Words to Weave In are listed, weave one naturally and end with a hook. If none, open with a brief curiosity-driven question about the user's day or a tiny cultural snippet. Never start with your name. Never paste raw data.";
  const eveningCronPrompt = env.EVENING_CRON_PROMPT ?? "Check ## Conversation State for session context and mood. Check ## Learner Profile and ## Current Learner Profile for the user's name, level, and Words to Weave In. Send a single short Spanish message (1-3 sentences). If Words to Weave In are listed, weave one naturally and end with a hook. If none, open with a brief curiosity-driven question about the user's day or a tiny cultural snippet. Never start with your name. Never paste raw data.";
  const dreamCron = env.DREAM_CRON ?? "0 23 * * *";
  const dreamMemoryPath = env.DREAM_MEMORY_PATH ?? path.resolve(process.cwd(), "data/memory/MEMORY.md");

  return {
    provider,
    transport,
    telegramToken,
    openrouterApiKey,
    openrouterModel,
    openrouterBaseUrl,
    ollamaBaseUrl,
    ollamaModel,
    ollamaApiKey,
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
