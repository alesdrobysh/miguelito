import { loadConfig } from "./infrastructure/config.js";
import { logger } from "./infrastructure/logger.js";
import { createRuntimeManager } from "./runtime.js";
import { TuiTransport } from "./transport/TuiTransport.js";
import { createTelegramTransport, runDreamIfOverdue, startLanguageScheduler, startTelegramTransport } from "./app/startup.js";

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
  const model = config.provider === "ollama" ? config.ollamaModel : config.chatModel;

  log.info({
    provider: config.provider,
    model,
    transport: config.transport,
    languages: manager.languages().map((l) => l.id),
  }, "miguelito starting");


  if (config.transport === "unified") {
    for (const language of manager.languages().map((lang) => lang.id)) {
      const token = config.telegramBotTokens[language];
      if (!token) throw new Error(`Missing Telegram token for active language: ${language}`);
      const transport = createTelegramTransport(config, language, token);
      const rt = manager.runtime(language);
      startLanguageScheduler(config, rt, transport);
      await startTelegramTransport(manager, config, language, transport);
      await runDreamIfOverdue(config, rt, rt.db);
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
    await runDreamIfOverdue(config, rt, rt.db);
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
