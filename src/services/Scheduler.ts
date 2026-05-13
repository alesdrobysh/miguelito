import cron from "node-cron";
import type { Transport } from "../transport/Transport.js";
import type { DreamService } from "./DreamService.js";

interface SchedulerConfig {
  morningCron: string;
  eveningCron: string;
  dreamCron: string;
  timezone: string;
  telegramChatId: string;
  morningCronPrompt: string;
  eveningCronPrompt: string;
}

export function startScheduler(
  config: SchedulerConfig,
  agentRunner: (prompt: string) => Promise<{ text: string }>,
  dream: DreamService,
  transport: Transport,
): void {
  async function runCronJob(prompt: string): Promise<void> {
    const result = await agentRunner(prompt);
    if (result.text && config.telegramChatId) {
      await transport.sendMessage(config.telegramChatId, result.text);
    }
  }

  if (config.morningCron) {
    cron.schedule(config.morningCron, () => runCronJob(config.morningCronPrompt), {
      timezone: config.timezone,
    });
  }

  if (config.eveningCron) {
    cron.schedule(config.eveningCron, () => runCronJob(config.eveningCronPrompt), {
      timezone: config.timezone,
    });
  }

  if (config.dreamCron) {
    cron.schedule(
      config.dreamCron,
      () =>
        dream.run().then(
          (result) => console.log("[dream]", result),
          (err) => console.error("[dream error]", err),
        ),
      { timezone: config.timezone },
    );
  }
}
