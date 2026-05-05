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


export function createBot(config: Config, db: BuddyDb): Bot {
  const bot = new Bot(config.telegramToken);
  const llmConfig: LLMConfig = {
    apiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    baseUrl: config.openrouterBaseUrl,
  };

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

  bot.command("start", (ctx) => runCommand(ctx, "/start").catch(logAndIgnore(ctx)));
  bot.command("progress", (ctx) => runCommand(ctx, "/progress").catch(logAndIgnore(ctx)));
  bot.command("progreso", (ctx) => runCommand(ctx, "/progreso").catch(logAndIgnore(ctx)));
  bot.command("vocabulary", (ctx) => runCommand(ctx, "/vocabulary").catch(logAndIgnore(ctx)));
  bot.command("export", (ctx) => runCommand(ctx, "/export").catch(logAndIgnore(ctx)));
  bot.command("reading", (ctx) => runCommand(ctx, "/reading").catch(logAndIgnore(ctx)));

  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx, config)) return;
    await handleMessage(ctx, config, db, llmConfig).catch(async (e) => {
      logAndIgnore(ctx)(e);
      try { await ctx.reply("⚠️ " + (e?.message ?? String(e)).slice(0, 200)); } catch {}
    });
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
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;
  const chatId = ctx.chat!.id;

  await ctx.api.sendChatAction(chatId, "typing");

  const history = (await db.getChatHistory(chatId, MAX_HISTORY)).map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  const result = await runAgentLoop(
    llmConfig,
    db,
    text,
    history,
    config.soulPath,
  );

  await db.addChatMessage(chatId, "user", text);
  if (result.text) {
    await db.addChatMessage(chatId, "assistant", result.text);
  }

  try {
    await ctx.reply(mdToTelegramHtml(result.text), { parse_mode: "HTML" });
  } catch {
    await ctx.reply(result.text);
  }
}

const logAndIgnore = (ctx: Context) => (e: any): void => {
  const msg = e?.message ?? String(e);
  console.error(`Error handling update ${ctx.update?.update_id}: ${msg.slice(0, 200)}`);
}
