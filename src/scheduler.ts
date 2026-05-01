import cron from "node-cron";
import { BuddyDb } from "./db.js";
import { runAgentLoop } from "./agent.js";
import { Config } from "./config.js";
import { ChatMessage, LLMConfig } from "./llm.js";
import { Bot } from "grammy";
import { mdToTelegramHtml } from "./format.js";

export function startScheduler(config: Config, db: BuddyDb, bot: Bot): void {
  const llmConfig: LLMConfig = {
    apiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    baseUrl: config.openrouterBaseUrl,
  };

  async function runCronJob(prompt: string): Promise<void> {
    const result = await runAgentLoop(
      llmConfig,
      db,
      prompt,
      [],
      config.soulPath,
    );

    if (result.text && config.telegramChatId) {
      try {
        await bot.api.sendMessage(config.telegramChatId, mdToTelegramHtml(result.text), {
          parse_mode: "HTML",
        });
      } catch {
        await bot.api.sendMessage(config.telegramChatId, result.text);
      }
    }
  }

  if (config.morningCron) {
    cron.schedule(config.morningCron, () => runCronJob(config.morningCronPrompt), {
      timezone: config.timezone,
    });
  }

  if (config.eveningCron) {
    cron.schedule(config.eveningCron, () => runCronJob(config.eveningCronPrompt), {
      timezone: config.timezone,
    });
  }
}
