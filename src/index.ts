import { loadConfig } from "./infrastructure/config.js";
import { BuddyDb } from "./infrastructure/db.js";
import { logger } from "./infrastructure/logger.js";
import { OpenRouterProvider } from "./providers/OpenRouterProvider.js";
import { OllamaProvider } from "./providers/OllamaProvider.js";
import { PromptBuilder } from "./agent/PromptBuilder.js";
import { AgentRunner } from "./agent/AgentRunner.js";
import { TelegramTransport } from "./transport/TelegramTransport.js";
import { TuiTransport } from "./transport/TuiTransport.js";
import { DreamService } from "./services/DreamService.js";
import { startScheduler } from "./services/Scheduler.js";
import type { ChatMessage } from "./llm.js";

const log = logger.child({ ctx: 'app' });

process.on("uncaughtException", (e) => {
  log.error({ err: e }, 'uncaughtException');
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  log.error({ err: e }, 'unhandledRejection');
  process.exit(1);
});

async function main() {
  const config = loadConfig();
  const db = await BuddyDb.open(config.dbPath);

  const provider = config.provider === "ollama"
    ? new OllamaProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        apiKey: config.ollamaApiKey || undefined,
      })
    : new OpenRouterProvider({
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel,
        baseUrl: config.openrouterBaseUrl,
      });

  const toolCtx = { vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider };
  const promptBuilder = new PromptBuilder({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db });

  const agentRunner = new AgentRunner({
    provider,
    session: db,
    promptBuilder,
    toolCtx,
    soulPath: config.soulPath,
    dreamMemoryPath: config.dreamMemoryPath,
  });

  const dreamService = new DreamService(db, db, db, provider, {
    timezone: config.timezone,
    dreamMemoryPath: config.dreamMemoryPath,
  });

  const transport = config.transport === "tui"
    ? new TuiTransport()
    : new TelegramTransport({
        telegramToken: config.telegramToken,
        allowedUsers: config.allowedUsers,
      });

  transport.onMessage(async (chatId, userId, text) => {
    if (text === "/dream") return dreamService.run();

    const history = await db.getChatHistory(chatId, 50) as ChatMessage[];
    const { session: convState } = await db.getConversationState();
    await db.addChatMessage(chatId, "user", text, convState.session_id);

    const result = await agentRunner.run(text, history);
    if (result.text) {
      await db.addChatMessage(chatId, "assistant", result.text, convState.session_id);
    }
    return result.text || null;
  });

  const model = config.provider === "ollama" ? config.ollamaModel : config.openrouterModel;
  log.info({ provider: config.provider, model, dbPath: config.dbPath, transport: config.transport }, 'miguelito-ts starting');

  if (config.transport === "telegram") {
    startScheduler(
      config,
      (prompt) => agentRunner.run(prompt, []),
      dreamService,
      transport,
    );
    transport.start({
      onStart: (info: { username: string }) => log.info({ username: info.username }, 'bot started'),
      allowed_updates: ["message"],
    });
  } else {
    transport.start();
  }
}

main();
