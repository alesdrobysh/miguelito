import { loadConfig } from "./infrastructure/config.js";
import { BuddyDb } from "./infrastructure/db.js";
import { OpenRouterProvider } from "./providers/OpenRouterProvider.js";
import { PromptBuilder } from "./agent/PromptBuilder.js";
import { AgentRunner } from "./agent/AgentRunner.js";
import { TelegramTransport } from "./transport/TelegramTransport.js";
import { DreamService } from "./services/DreamService.js";
import { startScheduler } from "./services/Scheduler.js";
import type { ChatMessage } from "./llm.js";

process.on("uncaughtException", (e) => {
  console.error("[uncaughtException]", e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error("[unhandledRejection]", e);
  process.exit(1);
});

async function main() {
  const config = loadConfig();
  const db = await BuddyDb.open(config.dbPath);

  const provider = new OpenRouterProvider({
    apiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    baseUrl: config.openrouterBaseUrl,
  });

  const toolCtx = { vocab: db, errors: db, profile: db, interests: db, competency: db, provider };
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

  const transport = new TelegramTransport({
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

  startScheduler(
    config,
    (prompt) => agentRunner.run(prompt, []),
    dreamService,
    transport,
  );

  console.log("miguelito-ts starting...");
  console.log(`Model: ${config.openrouterModel}`);
  console.log(`DB: ${config.dbPath}`);

  transport.start({
    onStart: (info: { username: string }) => console.log(`Bot @${info.username} started`),
    allowed_updates: ["message"],
  });
}

main();
