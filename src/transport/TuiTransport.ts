import * as readline from "readline";
import type { Transport, MessageHandler } from "./Transport.js";

const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

export class TuiTransport implements Transport {
  private handler: MessageHandler | null = null;
  private rl: readline.Interface | null = null;

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(_chatId: string | number, text: string): Promise<void> {
    console.log(`${YELLOW}[scheduled]${RESET} ${text}`);
  }

  start(_opts?: Record<string, unknown>): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${BOLD}${BLUE}> ${RESET}`,
    });

    console.log(`${BOLD}${YELLOW}miguelito-ts TUI${RESET}`);
    console.log(`${YELLOW}Type a message to chat with your tutor.${RESET}`);
    console.log(`${YELLOW}Just type naturally; Miguelito will remember useful material and bring it back in conversation.${RESET}`);
    console.log("");

    this.rl.prompt();

    this.rl.on("line", async (line) => {
      const text = line.trim();
      if (!text) {
        this.rl?.prompt();
        return;
      }

      if (text === "/quit") {
        console.log(`${YELLOW}Adiós!${RESET}`);
        this.rl?.close();
        process.exit(0);
      }

      if (!this.handler) {
        this.rl?.prompt();
        return;
      }

      try {
        const reply = await this.handler(0, "tui-user", text);
        if (reply) {
          console.log(`${GREEN}${reply}${RESET}`);
        }
      } catch (e: any) {
        console.log(`${RED}Error: ${(e?.message ?? String(e)).slice(0, 200)}${RESET}`);
      }

      this.rl?.prompt();
    });

    this.rl.on("close", () => {
      console.log(`${YELLOW}Adiós!${RESET}`);
      process.exit(0);
    });
  }
}
