import { loadConfig } from "./infrastructure/config.js";
import { loadLanguage } from "./languages/index.js";
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
import type { ProfileRepository } from "./repositories/interfaces.js";
import type { UserProfile } from "./domain/types.js";

class SplitProfileDb implements ProfileRepository {
  constructor(
    private langDb: ProfileRepository,
    private sharedDb: ProfileRepository
  ) {}

  async getProfile(): Promise<UserProfile | null> {
    const sharedProfile = await this.sharedDb.getProfile();
    const langProfile = await this.langDb.getProfile();

    if (!sharedProfile && !langProfile) return null;

    return {
      id: 1,
      name: sharedProfile?.name ?? null,
      correction_style: sharedProfile?.correction_style ?? null,
      goal: langProfile?.goal ?? null,
      started_at: sharedProfile?.started_at ?? langProfile?.started_at ?? "",
      updated_at: sharedProfile?.updated_at ?? langProfile?.updated_at ?? "",
    };
  }

  async setProfile(fields: Record<string, string>): Promise<string[]> {
    const sharedFields: Record<string, string> = {};
    const langFields: Record<string, string> = {};

    if ("name" in fields) sharedFields.name = fields.name;
    if ("correction_style" in fields) sharedFields.correction_style = fields.correction_style;
    if ("goal" in fields) langFields.goal = fields.goal;

    const updated: string[] = [];
    if (Object.keys(sharedFields).length > 0) {
      const up = await this.sharedDb.setProfile(sharedFields);
      updated.push(...up);
    }
    if (Object.keys(langFields).length > 0) {
      const up = await this.langDb.setProfile(langFields);
      updated.push(...up);
    }

    return updated;
  }
}

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
  const lang = loadLanguage(process.env.LANGUAGE ?? "spanish");

  if (!process.env.DB_PATH) {
    config.dbPath = `./data/buddy-${lang.id}.db`;
  }
  if (!process.env.DREAM_MEMORY_PATH) {
    config.dreamMemoryPath = `./data/memory/MEMORY-${lang.id}.md`;
  }

  const morningCronPrompt = process.env.MORNING_CRON_PROMPT ?? lang.prompts.morning;
  const eveningCronPrompt = process.env.EVENING_CRON_PROMPT ?? lang.prompts.evening;

  const db = await BuddyDb.open(config.dbPath, lang.id, lang.errorCategories, lang.morphologyCategories);
  const sharedDb = await BuddyDb.open("./data/buddy-shared.db", lang.id, [], []);

  const splitProfile = new SplitProfileDb(db, sharedDb);

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

  const toolCtx = {
    vocab: db,
    errors: db,
    profile: splitProfile,
    interests: sharedDb,
    competency: db,
    session: db,
    provider
  };
  const promptBuilder = new PromptBuilder(
    {
      vocab: db,
      errors: db,
      profile: splitProfile,
      interests: sharedDb,
      competency: db,
      session: db
    },
    lang,
  );

  const agentRunner = new AgentRunner({
    provider,
    session: db,
    promptBuilder,
    toolCtx,
    lang,
    dreamMemoryPath: config.dreamMemoryPath,
  });

  const dreamService = new DreamService(db, db, db, provider, {
    timezone: config.timezone,
    dreamMemoryPath: config.dreamMemoryPath,
    dreamSystemPrompt: lang.prompts.dream,
    morphologyCategories: new Set(lang.morphologyCategories),
  });

  const transport = config.transport === "tui"
    ? new TuiTransport()
    : new TelegramTransport({
        telegramToken: config.telegramToken,
        allowedUsers: config.allowedUsers,
      });

  transport.onMessage(async (chatId, userId, text) => {
    if (text === "/dream") return dreamService.run();

    const { session: convState } = await db.getConversationState();
    const history = await db.getSessionTranscript(convState.session_id) as ChatMessage[];
    await db.addChatMessage(chatId, "user", text, convState.session_id);

    const result = await agentRunner.run(text, history);
    if (result.text) {
      await db.addChatMessage(chatId, "assistant", result.text, convState.session_id);
    }
    return result.text || null;
  });

  const model = config.provider === "ollama" ? config.ollamaModel : config.openrouterModel;
  log.info({ provider: config.provider, model, dbPath: config.dbPath, transport: config.transport, language: lang.id }, 'miguelito-ts starting');

  if (config.transport === "telegram") {
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

main().catch((e) => {
  log.error({ err: e }, 'Fatal error in main');
  process.exit(1);
});
