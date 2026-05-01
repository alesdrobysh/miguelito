import { Bot, Context } from "grammy";
import { BuddyDb } from "./db.js";
import { runAgentLoop } from "./agent.js";
import { Config } from "./config.js";
import { ChatMessage, LLMConfig } from "./llm.js";
import { mdToTelegramHtml } from "./format.js";

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

    try {
      const result = await runAgentLoop(
        llmConfig,
        db,
        commandText,
        [],
        config.soulPath,
      );

      try {
        await ctx.reply(mdToTelegramHtml(result.text), { parse_mode: "HTML" });
      } catch {
        await ctx.reply(result.text);
      }
    } catch (e: any) {
      console.error("Error handling command:", e.message);
      await ctx.reply("Error: " + e.message.slice(0, 200));
    }
  }

  bot.command("start", (ctx) => runCommand(ctx, "/start").catch((e) => logAndIgnore(ctx, e)));
  bot.command("progress", (ctx) => runCommand(ctx, "/progress").catch((e) => logAndIgnore(ctx, e)));
  bot.command("progreso", (ctx) => runCommand(ctx, "/progreso").catch((e) => logAndIgnore(ctx, e)));
  bot.command("vocabulary", (ctx) => runCommand(ctx, "/vocabulary").catch((e) => logAndIgnore(ctx, e)));
  bot.command("export", (ctx) => runCommand(ctx, "/export").catch((e) => logAndIgnore(ctx, e)));
  bot.command("reading", (ctx) => runCommand(ctx, "/reading").catch((e) => logAndIgnore(ctx, e)));

  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx, config)) return;
    await handleMessage(ctx, config, db, llmConfig, chatHistories).catch((e) => logAndIgnore(ctx, e));
  });

  bot.catch((err) => {
    const ctx = (err as any).ctx;
    const msg = (err as any).error?.message ?? (err as any).message ?? "unknown";
    const updateId = ctx?.update?.update_id ?? "?";
    console.error(`Bot error (update ${updateId}): ${msg.slice(0, 200)}`);
  });

  return bot;
}

async function handleMessage(
  ctx: Context,
  config: Config,
  db: BuddyDb,
  llmConfig: LLMConfig,
  chatHistories: Map<number, ChatMessage[]>,
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;
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
    await ctx.reply(mdToTelegramHtml(result.text), { parse_mode: "HTML" });
  } catch {
    await ctx.reply(result.text);
  }
}

function logAndIgnore(ctx: Context, e: any): void {
  const msg = e?.message ?? String(e);
  console.error(`Error handling update ${ctx.update?.update_id}: ${msg.slice(0, 200)}`);
}
