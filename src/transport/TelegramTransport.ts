import { Bot, Context } from "grammy";
import { mdToTelegramHtml } from "../format.js";
import type { Transport, MessageHandler } from "./Transport.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'telegram' });

interface TelegramTransportConfig {
  telegramToken: string;
  allowedUsers: Set<string>;
}

export class TelegramTransport implements Transport {
  private bot: Bot;
  private allowedUsers: Set<string>;
  private handler: MessageHandler | null = null;

  constructor(config: TelegramTransportConfig) {
    this.bot = new Bot(config.telegramToken);
    this.allowedUsers = config.allowedUsers;
    this._registerHandlers();
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(String(chatId), mdToTelegramHtml(text), { parse_mode: "HTML" });
    } catch {
      await this.bot.api.sendMessage(String(chatId), text);
    }
  }

  start(opts?: Record<string, unknown>): void {
    this.bot.start(opts as any).catch((e) => {
      log.error({ err: e }, 'Telegram bot start error');
    });
  }

  private _isAllowed(ctx: Context): boolean {
    if (this.allowedUsers.size === 0) return true;
    const userId = ctx.from?.id?.toString();
    if (!userId) return false;
    return this.allowedUsers.has(userId);
  }

  private async _dispatch(ctx: Context, text: string): Promise<void> {
    if (!this._isAllowed(ctx)) {
      log.warn({ userId: ctx.from?.id?.toString()?.slice(0, 6) }, 'unauthorized user attempt');
      return;
    }
    if (!this.handler) return;

    const chatId = ctx.chat!.id;
    const userId = ctx.from?.id?.toString() ?? "";

    log.info({ chatId, userId: userId.slice(0, 6) }, 'message received');

    await ctx.api.sendChatAction(chatId, "typing");

    try {
      const reply = await this.handler(chatId, userId, text);
      if (reply) {
        await this._send(ctx, reply);
        log.info({ chatId }, 'reply sent');
      }
    } catch (e: any) {
      log.error({ updateId: ctx.update?.update_id, message: (e.message ?? String(e)).slice(0, 200) }, 'handler error');
      await ctx.reply("Error: " + (e.message ?? String(e)).slice(0, 200));
    }
  }

  private async _send(ctx: Context, text: string): Promise<void> {
    try {
      await ctx.reply(mdToTelegramHtml(text), { parse_mode: "HTML" });
    } catch {
      await ctx.reply(text);
    }
  }

  private _registerHandlers(): void {
    const commands = ["start", "progress", "vocabulary", "proficiency", "memory"];
    for (const cmd of commands) {
      this.bot.command(cmd, (ctx) =>
        this._dispatch(ctx, `/${cmd}`).catch(this._logError(ctx))
      );
    }

    this.bot.command("dream", async (ctx) => {
      if (!this._isAllowed(ctx)) {
        log.warn({ userId: ctx.from?.id?.toString()?.slice(0, 6) }, 'unauthorized user attempt');
        return;
      }
      if (!this.handler) return;

      const chatId = ctx.chat!.id;
      const userId = ctx.from?.id?.toString() ?? "";

      log.info({ chatId, userId: userId.slice(0, 6) }, 'message received');

      await ctx.reply("Dreaming...");
      try {
        const reply = await this.handler(chatId, userId, "/dream");
        if (reply) {
          await this._send(ctx, reply);
          log.info({ chatId }, 'reply sent');
        }
      } catch (e: any) {
        log.error({ updateId: ctx.update?.update_id, message: (e.message ?? String(e)).slice(0, 200) }, 'handler error');
        await ctx.reply("Dream failed: " + (e.message ?? String(e)).slice(0, 200));
      }
    });

    this.bot.on("message:text", async (ctx) => {
      if (!this._isAllowed(ctx)) {
        log.warn({ userId: ctx.from?.id?.toString()?.slice(0, 6) }, 'unauthorized user attempt');
        return;
      }
      const text = ctx.message?.text;
      if (!text) return;
      await this._dispatch(ctx, text).catch(async (e) => {
        this._logError(ctx)(e);
        try { await ctx.reply("⚠️ " + (e?.message ?? String(e)).slice(0, 200)); } catch {}
      });
    });

    this.bot.catch((err) => {
      const ctx = (err as any).ctx;
      const msg = (err as any).error?.message ?? (err as any).message ?? "unknown";
      const updateId = ctx?.update?.update_id ?? "?";
      log.error({ updateId, message: msg.slice(0, 200) }, 'handler error');
    });
  }

  private _logError(ctx: Context) {
    return (e: any): void => {
      const msg = e?.message ?? String(e);
      log.error({ updateId: ctx.update?.update_id, message: msg.slice(0, 200) }, 'handler error');
    };
  }
}
