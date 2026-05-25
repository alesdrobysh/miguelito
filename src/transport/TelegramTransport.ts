import { Bot, Context } from "grammy";
import { mdToTelegramHtml } from "../format.js";
import type { Transport, MessageHandler } from "./Transport.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'telegram' });

export const TELEGRAM_COMMANDS = [
  { command: "start", description: "Start Miguelito" },
  { command: "progress", description: "Show learning progress" },
  { command: "vocabulary", description: "List active vocabulary chunks" },
  { command: "learning", description: "List active learning items" },
  { command: "practice", description: "Practice active learning items" },
  { command: "vocab_candidates", description: "List staged vocabulary candidates" },
  { command: "promote_vocab", description: "Promote strong vocabulary candidates" },
  { command: "accept_vocab", description: "Accept candidate: /accept_vocab <id>" },
  { command: "reject_vocab", description: "Reject candidate: /reject_vocab <id>" },
  { command: "proficiency", description: "Show proficiency diagnostics" },
  { command: "memory", description: "Show dream memory" },
  { command: "dream", description: "Run dream reflection" },
] as const;

const SIMPLE_COMMANDS = TELEGRAM_COMMANDS
  .map((c) => c.command)
  .filter((cmd) => cmd !== "dream" && cmd !== "accept_vocab" && cmd !== "reject_vocab") as string[];

function normalizeTelegramCommandText(text: string): string {
  if (text.startsWith("/vocab_candidates")) return text.replace("/vocab_candidates", "/vocab-candidates");
  if (text.startsWith("/promote_vocab")) return text.replace("/promote_vocab", "/promote-vocab");
  if (text.startsWith("/accept_vocab")) return text.replace("/accept_vocab", "/accept-vocab");
  if (text.startsWith("/reject_vocab")) return text.replace("/reject_vocab", "/reject-vocab");
  return text;
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
      await this.bot.api.sendMessage(String(chatId), mdToTelegramHtml(text), { parse_mode: "HTML" });
    } catch {
      await this.bot.api.sendMessage(String(chatId), text);
    }
  }

  start(opts?: Record<string, unknown>): void {
    this.bot.api.setMyCommands([...TELEGRAM_COMMANDS]).catch((e) => {
      log.error({ ...this.logFields, err: e }, 'Telegram set commands error');
    });
    this.bot.start(opts as any).catch((e) => {
      log.error({ ...this.logFields, err: e }, 'Telegram bot start error');
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
      await ctx.reply(mdToTelegramHtml(text), { parse_mode: "HTML" });
    } catch {
      await ctx.reply(text);
    }
  }

  private _registerHandlers(): void {
    for (const cmd of SIMPLE_COMMANDS) {
      this.bot.command(cmd, (ctx) =>
        this._dispatch(ctx, normalizeTelegramCommandText(ctx.message?.text ?? `/${cmd}`)).catch(this._logError(ctx))
      );
    }

    for (const cmd of ["accept_vocab", "reject_vocab"]) {
      this.bot.command(cmd, (ctx) =>
        this._dispatch(ctx, normalizeTelegramCommandText(ctx.message?.text ?? `/${cmd}`)).catch(this._logError(ctx))
      );
    }

    this.bot.command("dream", async (ctx) => {
      if (!this._isAllowed(ctx)) {
        log.warn({ ...this.logFields, userId: ctx.from?.id?.toString()?.slice(0, 6) }, 'unauthorized user attempt');
        return;
      }
      if (!this.handler) return;

      const chatId = ctx.chat!.id;
      const userId = ctx.from?.id?.toString() ?? "";

      log.info({ ...this.logFields, chatId, userId: userId.slice(0, 6) }, 'message received');

      await ctx.reply("Dreaming...");
      try {
        const reply = await this.handler(chatId, userId, "/dream");
        if (reply) {
          await this._send(ctx, reply);
          log.info({ ...this.logFields, chatId }, 'reply sent');
        }
      } catch (e: any) {
        log.error({ ...this.logFields, updateId: ctx.update?.update_id, message: (e.message ?? String(e)).slice(0, 200) }, 'handler error');
        await ctx.reply("Dream failed: " + (e.message ?? String(e)).slice(0, 200));
      }
    });

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
