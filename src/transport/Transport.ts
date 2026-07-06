export type MessageHandler = (chatId: number, userId: string, text: string) => Promise<string | null>;

export interface Transport {
  onMessage(handler: MessageHandler): void;
  sendMessage(chatId: string | number, text: string): Promise<void>;
  start(opts?: Record<string, unknown>): void | Promise<void>;
}
