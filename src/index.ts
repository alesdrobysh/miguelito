import { loadConfig } from "./infrastructure/config.js";
import { logger } from "./infrastructure/logger.js";
import { createRuntimeManager } from "./runtime.js";
import { TuiTransport } from "./transport/TuiTransport.js";
import { createTelegramTransport, startLanguageScheduler, startTelegramTransport } from "./app/startup.js";

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


  if (config.transport === "unified") {
    const telegramBots = [
      { language: "polish", token: config.telegramBotTokens.polish! },
      { language: "spanish", token: config.telegramBotTokens.spanish! },
    ];

    for (const bot of telegramBots) {
      const transport = createTelegramTransport(config, bot.language, bot.token);
      const rt = manager.runtime(bot.language);
      startLanguageScheduler(config, rt, transport);
      startTelegramTransport(manager, config, bot.language, transport);
    }

    return;
  }

  const transport = config.transport === "tui"
    ? new TuiTransport()
    : createTelegramTransport(config, defaultLanguage, config.telegramToken);

  transport.onMessage((chatId, userId, text) => manager.handleMessage(defaultLanguage, Number(chatId), userId, text));

  if (config.transport === "telegram") {
    const rt = manager.runtime(defaultLanguage);
    startLanguageScheduler(config, rt, transport);
    transport.start({
      onStart: (info: { username: string }) => log.info({ username: info.username, language: defaultLanguage }, "bot started"),
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
