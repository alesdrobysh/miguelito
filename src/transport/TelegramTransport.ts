import { Bot, Context } from "grammy";
import { mdToTelegramHtml } from "../format.js";
import type { Transport, MessageHandler } from "./Transport.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'telegram' });

export const TELEGRAM_COMMANDS = [
  { command: "start", description: "Запустить Miguelito" },
  { command: "import", description: "Импортировать фразы/Anki TSV" },
  { command: "drill", description: "Короткая тренировка" },
  { command: "scenario", description: "Короткий сценарий" },
  { command: "today", description: "Миссия дня" },
  { command: "mistakes", description: "Повторить ошибки" },
  { command: "progress", description: "Короткий прогресс" },
  { command: "next", description: "Следующий шаг" },
] as const;

const MENU_COMMANDS = TELEGRAM_COMMANDS.map((c) => c.command) as string[];
export const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"] as const;

export function telegramReplyMarkupForText(text: string): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined {
  const buttons = text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\/scenario\s+([^\s]+)\s+—\s+(.+)$/);
    return match ? [[{ text: match[2]!.trim(), callback_data: `/scenario ${match[1]!.trim()}` }]] : [];
  });
  return buttons.length ? { inline_keyboard: buttons } : undefined;
}

export function telegramDisplayTextForText(text: string): string {
  if (!telegramReplyMarkupForText(text)) return text;
  const display = text.split(/\r?\n/).filter((line) => !line.match(/^\/scenario\s+[^\s]+\s+—\s+.+$/)).join("\n").trim();
  return display || "Elige una opción:";
}

interface TelegramTransportConfig {
  telegramToken: string;
  allowedUsers: Set<string>;
  language?: string;
  botLabel?: string;
}

export class TelegramTransport implements Transport {
  private bot: Bot;
  private allowedUsers: Set<string>;
  private handler: MessageHandler | null = null;
  private logFields: { language?: string; botLabel?: string };

  constructor(config: TelegramTransportConfig) {
    this.bot = new Bot(config.telegramToken);
    this.allowedUsers = config.allowedUsers;
    this.logFields = { language: config.language, botLabel: config.botLabel };
    this._registerHandlers();
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    try {
      const replyMarkup = telegramReplyMarkupForText(text);
      const displayText = telegramDisplayTextForText(text);
      await this.bot.api.sendMessage(String(chatId), mdToTelegramHtml(displayText), { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
    } catch {
      await this.bot.api.sendMessage(String(chatId), text);
    }
  }

  async start(opts?: Record<string, unknown>): Promise<void> {
    this.bot.api.setMyCommands([...TELEGRAM_COMMANDS]).catch((e) => {
      log.error({ ...this.logFields, err: e }, 'Telegram set commands error');
    });
    await this.bot.start(opts as any);
  }

  private _isAllowed(ctx: Context): boolean {
    if (this.allowedUsers.size === 0) return true;
    const userId = ctx.from?.id?.toString();
    if (!userId) return false;
    return this.allowedUsers.has(userId);
  }

  private async _dispatch(ctx: Context, text: string): Promise<void> {
    if (!this._isAllowed(ctx)) {
      log.warn({ ...this.logFields, userId: ctx.from?.id?.toString()?.slice(0, 6) }, 'unauthorized user attempt');
      return;
    }
    if (!this.handler) return;

    const chatId = ctx.chat!.id;
    const userId = ctx.from?.id?.toString() ?? "";

    log.info({ ...this.logFields, chatId, userId: userId.slice(0, 6) }, 'message received');

    await ctx.api.sendChatAction(chatId, "typing");

    try {
      const reply = await this.handler(chatId, userId, text);
      if (reply) {
        await this._send(ctx, reply);
        log.info({ ...this.logFields, chatId }, 'reply sent');
      }
    } catch (e: any) {
      log.error({ ...this.logFields, updateId: ctx.update?.update_id, message: (e.message ?? String(e)).slice(0, 200) }, 'handler error');
      await ctx.reply("Error: " + (e.message ?? String(e)).slice(0, 200));
    }
  }

  private async _send(ctx: Context, text: string): Promise<void> {
    try {
      const replyMarkup = telegramReplyMarkupForText(text);
      const displayText = telegramDisplayTextForText(text);
      await ctx.reply(mdToTelegramHtml(displayText), { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
    } catch {
      await ctx.reply(text);
    }
  }

  private _registerHandlers(): void {
    for (const cmd of MENU_COMMANDS) {
      this.bot.command(cmd, (ctx) =>
        this._dispatch(ctx, ctx.message?.text ?? `/${cmd}`).catch(this._logError(ctx))
      );
    }

    this.bot.on("message:text", async (ctx) => {
      if (!this._isAllowed(ctx)) {
        log.warn({ ...this.logFields, userId: ctx.from?.id?.toString()?.slice(0, 6) }, 'unauthorized user attempt');
        return;
      }
      const text = ctx.message?.text;
      if (!text) return;
      await this._dispatch(ctx, text).catch(async (e) => {
        this._logError(ctx)(e);
        try { await ctx.reply("⚠️ " + (e?.message ?? String(e)).slice(0, 200)); } catch {}
      });
    });

    this.bot.on("callback_query:data", async (ctx) => {
      if (!this._isAllowed(ctx)) {
        log.warn({ ...this.logFields, userId: ctx.from?.id?.toString()?.slice(0, 6) }, 'unauthorized user attempt');
        return;
      }
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery().catch(() => undefined);
      if (data.startsWith("/scenario ")) await this._dispatch(ctx, data).catch(this._logError(ctx));
    });

    this.bot.catch((err) => {
      const ctx = (err as any).ctx;
      const msg = (err as any).error?.message ?? (err as any).message ?? "unknown";
      const updateId = ctx?.update?.update_id ?? "?";
      log.error({ ...this.logFields, updateId, message: msg.slice(0, 200) }, 'handler error');
    });
  }

  private _logError(ctx: Context) {
    return (e: any): void => {
      const msg = e?.message ?? String(e);
      log.error({ ...this.logFields, updateId: ctx.update?.update_id, message: msg.slice(0, 200) }, 'handler error');
    };
  }
}
