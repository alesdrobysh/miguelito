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
}

export function startScheduler(
  config: SchedulerConfig,
  agentRunner: (prompt: string) => Promise<{ text: string }>,
  dream: DreamService,
  transport: Transport,
): void {
  async function runCronJob(jobName: string, prompt: string): Promise<void> {
    log.info({ job: jobName }, 'cron job fired');
    try {
      const result = await agentRunner(prompt);
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
