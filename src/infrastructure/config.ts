import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface Config {
  provider: "openrouter" | "ollama";
  transport: "telegram" | "tui" | "unified";
  telegramToken: string;
  telegramBotTokens: Partial<Record<"polish" | "spanish", string>>;
  openrouterApiKey: string;
  openrouterModel: string;
  evaluatorModel: string;
  openrouterBaseUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaApiKey: string;
  dbPath: string;
  dataDir: string;
  allowedUsers: Set<string>;
  morningCron: string;
  eveningCron: string;
  timezone: string;
  telegramChatId: string;
  dreamCron: string;
  dreamMemoryPath: string;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const provider = (env.PROVIDER ?? "openrouter") as Config["provider"];
  if (provider !== "openrouter" && provider !== "ollama") {
    throw new Error(`Unsupported PROVIDER: ${provider}`);
  }
  const transport = (env.TRANSPORT ?? "telegram") as Config["transport"];
  if (transport !== "telegram" && transport !== "tui" && transport !== "unified") {
    throw new Error(`Unsupported TRANSPORT: ${transport}`);
  }
  const telegramToken = env.TELEGRAM_BOT_TOKEN ?? "";
  const telegramBotTokens: Config["telegramBotTokens"] = {
    polish: env.TELEGRAM_POLISH_BOT_TOKEN ?? undefined,
    spanish: env.TELEGRAM_SPANISH_BOT_TOKEN ?? undefined,
  };
  const openrouterApiKey = env.OPENROUTER_API_KEY ?? "";
  const openrouterModel = env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-lite";
  const evaluatorModel = env.EVALUATOR_MODEL ?? "google/gemini-2.5-flash-lite";
  const openrouterBaseUrl = env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const ollamaBaseUrl = env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  const ollamaModel = env.OLLAMA_MODEL ?? "llama3.2";
  const ollamaApiKey = env.OLLAMA_API_KEY ?? "";
  const isTestEnv = env.ENV === "test";
  const dataDir = env.DATA_DIR ?? path.resolve(process.cwd(), isTestEnv ? "data-test" : "data");
  const dbPath = env.DB_PATH ?? path.join(dataDir, "buddy.db");
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
  if (transport === "unified") {
    if (!telegramBotTokens.polish) throw new Error("TELEGRAM_POLISH_BOT_TOKEN is required when TRANSPORT=unified");
    if (!telegramBotTokens.spanish) throw new Error("TELEGRAM_SPANISH_BOT_TOKEN is required when TRANSPORT=unified");
    if (!telegramChatId) throw new Error("TELEGRAM_CHAT_ID is required when TRANSPORT=unified");
  }

  const dreamCron = env.DREAM_CRON ?? "0 23 * * *";
  const dreamMemoryPath = env.DREAM_MEMORY_PATH ?? path.join(dataDir, "memory", "MEMORY.md");
  return {
    provider,
    transport,
    telegramToken,
    telegramBotTokens,
    openrouterApiKey,
    openrouterModel,
    evaluatorModel,
    openrouterBaseUrl,
    ollamaBaseUrl,
    ollamaModel,
    ollamaApiKey,
    dbPath,
    dataDir,
    allowedUsers,
    morningCron,
    eveningCron,
    timezone,
    telegramChatId,
    dreamCron,
    dreamMemoryPath,
  };
}

