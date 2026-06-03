import type { Config } from "../infrastructure/config.js";
import { logger } from "../infrastructure/logger.js";
import type { LanguageRuntime, RuntimeManager } from "../runtime.js";
import type { MetaRepository } from "../repositories/interfaces.js";
import { startScheduler } from "../services/Scheduler.js";
import { TelegramTransport } from "../transport/TelegramTransport.js";
import type { Transport } from "../transport/Transport.js";

const log = logger.child({ ctx: "app" });

export async function runDreamIfOverdue(
  config: Config,
  rt: LanguageRuntime,
  meta: MetaRepository,
): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const lastDate = await meta.getMetaValue(`last_dream_date:${rt.lang.id}`);
  if (!lastDate || lastDate >= today) return;
  rt.dreamService.run().then(
    (result) => log.info({ result, lang: rt.lang.id }, "startup dream complete"),
    (err) => log.error({ err, lang: rt.lang.id }, "startup dream error"),
  );
}

export function startLanguageScheduler(config: Config, rt: LanguageRuntime, transport: Transport): void {
  const morningCronPrompt = process.env.MORNING_CRON_PROMPT ?? rt.lang.prompts.morning;
  const eveningCronPrompt = process.env.EVENING_CRON_PROMPT ?? rt.lang.prompts.evening;
  startScheduler(
    {
      morningCron: config.morningCron,
      eveningCron: config.eveningCron,
      dreamCron: config.dreamCron,
      timezone: config.timezone,
      telegramChatId: config.telegramChatId,
      morningCronPrompt,
      eveningCronPrompt,
    },
    (prompt) => rt.agentRunner.run(prompt, []),
    rt.dreamService,
    transport,
  );
}

export function createTelegramTransport(config: Config, language: string, token: string): TelegramTransport {
  return new TelegramTransport({
    telegramToken: token,
    allowedUsers: config.allowedUsers,
    language,
    botLabel: `${language}-telegram`,
  });
}

export function startTelegramTransport(manager: RuntimeManager, config: Config, language: string, transport: TelegramTransport): void {
  transport.onMessage((chatId, userId, text) => manager.handleMessage(language, Number(chatId), userId, text));
  transport.start({
    onStart: (info: { username: string }) => log.info({ username: info.username, language }, "bot started"),
    allowed_updates: ["message"],
  });
}
