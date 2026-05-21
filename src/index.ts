import { loadConfig } from "./infrastructure/config.js";
import { logger } from "./infrastructure/logger.js";
import { createRuntimeManager } from "./runtime.js";
import { TelegramTransport } from "./transport/TelegramTransport.js";
import { TuiTransport } from "./transport/TuiTransport.js";
import { startScheduler } from "./services/Scheduler.js";
import { WebServer } from "./web/WebServer.js";

const log = logger.child({ ctx: "app" });

process.on("uncaughtException", (e) => {
  log.error({ err: e }, "uncaughtException");
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  log.error({ err: e }, "unhandledRejection");
  process.exit(1);
});

async function main() {
  const config = loadConfig();
  const manager = await createRuntimeManager(config);
  const defaultLanguage = process.env.LANGUAGE ?? "spanish";
  const model = config.provider === "ollama" ? config.ollamaModel : config.openrouterModel;

  log.info({
    provider: config.provider,
    model,
    transport: config.transport,
    languages: manager.languages().map((l) => l.id),
  }, "miguelito starting");

  if (config.transport === "web") {
    new WebServer(manager).start(config.webHost, config.webPort);
    return;
  }

  const transport = config.transport === "tui"
    ? new TuiTransport()
    : new TelegramTransport({ telegramToken: config.telegramToken, allowedUsers: config.allowedUsers });

  transport.onMessage((chatId, userId, text) => manager.handleMessage(defaultLanguage, Number(chatId), userId, text));

  if (config.transport === "telegram") {
    const rt = manager.runtime(defaultLanguage);
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
    transport.start({
      onStart: (info: { username: string }) => log.info({ username: info.username }, "bot started"),
      allowed_updates: ["message"],
    });
  } else {
    transport.start();
  }
}

main().catch((e) => {
  log.error({ err: e }, "Fatal error in main");
  process.exit(1);
});
