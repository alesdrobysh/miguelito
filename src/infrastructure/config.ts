import dotenv from "dotenv";
import path from "path";
import { listAvailableLanguages } from "../languages/index.js";

dotenv.config();

export interface Config {
  provider: "openrouter" | "ollama";
  transport: "telegram" | "tui" | "unified";
  telegramToken: string;
  telegramBotTokens: Record<string, string | undefined>;
  openrouterApiKey: string;
  chatModel: string;
  evaluatorModel: string;
  openrouterBaseUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaApiKey: string;
  dbPath: string;
  dataDir: string;
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
  const activeLanguages = listAvailableLanguages();
  const telegramBotTokens: Config["telegramBotTokens"] = Object.fromEntries(
    activeLanguages.map((lang) => [lang.id, env[`TELEGRAM_${lang.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BOT_TOKEN`] ?? undefined]),
  );
  const openrouterApiKey = env.OPENROUTER_API_KEY ?? "";
  const chatModel = env.CHAT_MODEL ?? env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite-preview";
  const evaluatorModel = env.EVALUATOR_MODEL ?? "deepseek/deepseek-v4-flash";
  const openrouterBaseUrl = env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const ollamaBaseUrl = env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  const ollamaModel = env.OLLAMA_MODEL ?? "llama3.2";
  const ollamaApiKey = env.OLLAMA_API_KEY ?? "";
  const isTestEnv = env.ENV === "test";
  const dataDir = env.DATA_DIR ?? path.resolve(process.cwd(), isTestEnv ? "data-test" : "data");
  const dbPath = env.DB_PATH ?? path.join(dataDir, "buddy.db");
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
    for (const lang of activeLanguages) {
      const envName = `TELEGRAM_${lang.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BOT_TOKEN`;
      if (!telegramBotTokens[lang.id]) throw new Error(`${envName} is required when TRANSPORT=unified`);
    }
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
    chatModel,
    evaluatorModel,
    openrouterBaseUrl,
    ollamaBaseUrl,
    ollamaModel,
    ollamaApiKey,
    dbPath,
    dataDir,
    morningCron,
    eveningCron,
    timezone,
    telegramChatId,
    dreamCron,
    dreamMemoryPath,
  };
}

