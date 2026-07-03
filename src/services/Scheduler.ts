import cron from "node-cron";
import type { Transport } from "../transport/Transport.js";
import type { DreamService } from "./DreamService.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'scheduler' });

interface SchedulerConfig {
  morningCron: string;
  eveningCron: string;
  dreamCron: string;
  timezone: string;
  telegramChatId: string;
  morningCronPrompt: string;
  eveningCronPrompt: string;
  reactivationShortPrompt?: string;
  reactivationLongPrompt?: string;
  getDaysSinceLastUserMessage?: () => Promise<number | null>;
}

export function selectCronPrompt(args: {
  normalPrompt: string;
  shortReactivationPrompt: string;
  longReactivationPrompt: string;
  daysSinceLastUserMessage: number | null;
}): string {
  if (args.daysSinceLastUserMessage == null || args.daysSinceLastUserMessage < 3) return args.normalPrompt;
  if (args.daysSinceLastUserMessage <= 7) return args.shortReactivationPrompt;
  return args.longReactivationPrompt;
}
export function startScheduler(
  config: SchedulerConfig,
  agentRunner: (prompt: string, options?: { postTurn?: boolean; sourceType?: "cron" | "proactive" | "system" | "user_chat" }) => Promise<{ text: string }>,
  dream: DreamService,
  transport: Transport,
): void {
  async function runCronJob(jobName: string, prompt: string): Promise<void> {
    log.info({ job: jobName }, 'cron job fired');
    try {
      const daysSinceLastUserMessage = config.getDaysSinceLastUserMessage ? await config.getDaysSinceLastUserMessage() : null;
      const selectedPrompt = selectCronPrompt({
        normalPrompt: prompt,
        shortReactivationPrompt: config.reactivationShortPrompt ?? prompt,
        longReactivationPrompt: config.reactivationLongPrompt ?? config.reactivationShortPrompt ?? prompt,
        daysSinceLastUserMessage,
      });
      const result = await agentRunner(selectedPrompt, { postTurn: false, sourceType: "cron" });
      log.info({ job: jobName }, 'cron job complete');
      if (result.text && config.telegramChatId) {
        await transport.sendMessage(config.telegramChatId, result.text);
      }
    } catch (err) {
      log.error({ job: jobName, err }, 'cron job error');
    }
  }

  if (config.morningCron) {
    cron.schedule(config.morningCron, () => runCronJob('morning', config.morningCronPrompt), {
      timezone: config.timezone,
    });
  }

  if (config.eveningCron) {
    cron.schedule(config.eveningCron, () => runCronJob('evening', config.eveningCronPrompt), {
      timezone: config.timezone,
    });
  }

  if (config.dreamCron) {
    cron.schedule(
      config.dreamCron,
      () => {
        log.info({ job: 'dream' }, 'cron job fired');
        dream.run().then(
          (result) => log.info({ job: 'dream', result }, 'cron job complete'),
          (err) => log.error({ job: 'dream', err }, 'cron job error'),
        );
      },
      { timezone: config.timezone },
    );
  }
}
