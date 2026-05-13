import { Bot, Context } from "grammy";
import { mdToTelegramHtml } from "../format.js";
import type { Transport, MessageHandler } from "./Transport.js";

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
    this.bot.start(opts as any);
  }

  private _isAllowed(ctx: Context): boolean {
    if (this.allowedUsers.size === 0) return true;
    const userId = ctx.from?.id?.toString();
    if (!userId) return false;
    return this.allowedUsers.has(userId);
  }

  private async _dispatch(ctx: Context, text: string): Promise<void> {
    if (!this._isAllowed(ctx)) return;
    if (!this.handler) return;

    const chatId = ctx.chat!.id;
    const userId = ctx.from?.id?.toString() ?? "";

    await ctx.api.sendChatAction(chatId, "typing");

    try {
      const reply = await this.handler(chatId, userId, text);
      if (reply) await this._send(ctx, reply);
    } catch (e: any) {
      console.error("Error handling message:", e.message);
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
    const commands = ["start", "progress", "vocabulary"];
    for (const cmd of commands) {
      this.bot.command(cmd, (ctx) =>
        this._dispatch(ctx, `/${cmd}`).catch(this._logError(ctx))
      );
    }

    // /dream: send "Dreaming..." immediately, then dispatch and send result
    this.bot.command("dream", async (ctx) => {
      if (!this._isAllowed(ctx)) return;
      if (!this.handler) return;

      const chatId = ctx.chat!.id;
      const userId = ctx.from?.id?.toString() ?? "";

      await ctx.reply("Dreaming...");
      try {
        const reply = await this.handler(chatId, userId, "/dream");
        if (reply) await this._send(ctx, reply);
      } catch (e: any) {
        console.error("Dream error:", e.message);
        await ctx.reply("Dream failed: " + (e.message ?? String(e)).slice(0, 200));
      }
    });

    this.bot.on("message:text", async (ctx) => {
      if (!this._isAllowed(ctx)) return;
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
      console.error(`Bot error (update ${updateId}): ${msg.slice(0, 200)}`);
    });
  }

  private _logError(ctx: Context) {
    return (e: any): void => {
      const msg = e?.message ?? String(e);
      console.error(`Error handling update ${ctx.update?.update_id}: ${msg.slice(0, 200)}`);
    };
  }
}
