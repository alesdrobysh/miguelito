import { Bot, Context } from "grammy";
import { BuddyDb } from "./db.js";
import { runAgentLoop } from "./agent.js";
import { Config } from "./config.js";
import { ChatMessage, LLMConfig } from "./llm.js";

const MAX_HISTORY = 50;

function isAllowed(ctx: Context, config: Config): boolean {
  if (config.allowedUsers.size === 0) return true;
  const userId = ctx.from?.id?.toString();
  if (!userId) return false;
  return config.allowedUsers.has(userId);
}

function trackHistory(
  map: Map<number, ChatMessage[]>,
  chatId: number,
  msg: ChatMessage,
): void {
  const history = map.get(chatId) ?? [];
  history.push(msg);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  map.set(chatId, history);
}

function getHistory(map: Map<number, ChatMessage[]>, chatId: number): ChatMessage[] {
  return map.get(chatId) ?? [];
}

export function createBot(config: Config, db: BuddyDb): Bot {
  const bot = new Bot(config.telegramToken);
  const llmConfig: LLMConfig = {
    apiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    baseUrl: config.openrouterBaseUrl,
  };

  const chatHistories = new Map<number, ChatMessage[]>();

  async function runCommand(ctx: Context, commandText: string): Promise<void> {
    if (!isAllowed(ctx, config)) return;

    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const result = await runAgentLoop(
      llmConfig,
      db,
      commandText,
      [],
      config.soulPath,
    );

    try {
      await ctx.reply(result.text, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(result.text);
    }
  }

  bot.command("start", (ctx) => runCommand(ctx, "/start"));
  bot.command("progress", (ctx) => runCommand(ctx, "/progress"));
  bot.command("progreso", (ctx) => runCommand(ctx, "/progreso"));
  bot.command("vocabulary", (ctx) => runCommand(ctx, "/vocabulary"));
  bot.command("export", (ctx) => runCommand(ctx, "/export"));
  bot.command("reading", (ctx) => runCommand(ctx, "/reading"));

  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx, config)) return;

    const text = ctx.message.text;
    const chatId = ctx.chat!.id;

    await ctx.api.sendChatAction(chatId, "typing");

    const history = getHistory(chatHistories, chatId);

    const result = await runAgentLoop(
      llmConfig,
      db,
      text,
      history,
      config.soulPath,
    );

    trackHistory(chatHistories, chatId, { role: "user", content: text });
    if (result.text) {
      trackHistory(chatHistories, chatId, { role: "assistant", content: result.text });
    }

    try {
      await ctx.reply(result.text, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(result.text);
    }
  });

  return bot;
}
