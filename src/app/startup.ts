import cron from "node-cron";
import type { Config } from "../infrastructure/config.js";
import { logger } from "../infrastructure/logger.js";
import type { LanguageRuntime, RuntimeManager } from "../runtime.js";
import { FuzzyDedupeService } from "../services/FuzzyDedupeService.js";
import type { MetaRepository } from "../repositories/interfaces.js";
import { startScheduler } from "../services/Scheduler.js";
import { TelegramTransport } from "../transport/TelegramTransport.js";
import type { Transport } from "../transport/Transport.js";

const log = logger.child({ ctx: "app" });

export async function runDreamIfOverdue(
  config: Config,
  rt: LanguageRuntime,
  meta: MetaRepository,
): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const lastDate = await meta.getMetaValue(`last_dream_date:${rt.lang.id}`);
  if (lastDate && lastDate >= today) return;
  if (!lastDate) {
    const msgs = await rt.db.getTodaysMessages(today);
    if (msgs.length === 0) return;
  }
  rt.dreamService.run().then(
    (result) => log.info({ result, lang: rt.lang.id }, "startup dream complete"),
    (err) => log.error({ err, lang: rt.lang.id }, "startup dream error"),
  );
}

export async function runNightlyMaintenanceIfOverdue(
  config: Config,
  rt: LanguageRuntime,
  meta: MetaRepository,
): Promise<{ learningItemsMerged: number; errorsMerged: number; fuzzyLearningCandidates: number; fuzzyLearningItemsMerged: number; fuzzyErrorsMerged: number }> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const key = `last_nightly_maintenance_date:${rt.lang.id}`;
  const lastDate = await meta.getMetaValue(key);
  if (lastDate && lastDate >= today) return { learningItemsMerged: 0, errorsMerged: 0, fuzzyLearningCandidates: 0, fuzzyLearningItemsMerged: 0, fuzzyErrorsMerged: 0 };

  const [learningItemsMerged, errorsMerged] = await Promise.all([
    rt.db.deduplicateLearningItems(),
    rt.db.deduplicateErrors(),
  ]);
  const fuzzyLearning = new FuzzyDedupeService(rt.db, rt.evaluatorProvider);
  const [fuzzyLearningResult, fuzzyErrorsMerged] = await Promise.all([
    fuzzyLearning.adjudicateAndApply({ limit: 50, batchSize: 8, minConfidence: 0.92 }),
    rt.db.deduplicateFuzzyErrors(),
  ]);
  await meta.setMetaValue(key, today);
  return {
    learningItemsMerged,
    errorsMerged,
    fuzzyLearningCandidates: fuzzyLearningResult.candidates.length,
    fuzzyLearningItemsMerged: fuzzyLearningResult.appliedMerges,
    fuzzyErrorsMerged,
  };
}

export function startNightlyMaintenance(config: Config, rt: LanguageRuntime, meta: MetaRepository = rt.db): void {
  const run = () => {
    runNightlyMaintenanceIfOverdue(config, rt, meta).then(
      ({ learningItemsMerged, errorsMerged, fuzzyLearningCandidates, fuzzyLearningItemsMerged, fuzzyErrorsMerged }) => {
        if (learningItemsMerged > 0 || errorsMerged > 0 || fuzzyLearningCandidates > 0 || fuzzyLearningItemsMerged > 0 || fuzzyErrorsMerged > 0) {
          log.info({ lang: rt.lang.id, learningItemsMerged, errorsMerged, fuzzyLearningCandidates, fuzzyLearningItemsMerged, fuzzyErrorsMerged }, "nightly maintenance dedupe complete");
        }
      },
      (err) => log.warn({ err, lang: rt.lang.id }, "nightly maintenance failed"),
    );
  };
  run();
  cron.schedule("15 2 * * *", run, { timezone: config.timezone });
}

export function startLanguageScheduler(config: Config, rt: LanguageRuntime, transport: Transport): void {
  startNightlyMaintenance(config, rt);
  const morningCronPrompt = process.env.MORNING_CRON_PROMPT ?? rt.lang.prompts.morning;
  const eveningCronPrompt = process.env.EVENING_CRON_PROMPT ?? rt.lang.prompts.evening;
  startScheduler(
    {
      morningCron: config.morningCron,
      eveningCron: config.eveningCron,
      dreamCron: config.dreamCron,
      timezone: config.timezone,
      telegramChatId: config.telegramChatId,
      morningCronPrompt,
      eveningCronPrompt,
    },
    (prompt, options) => rt.agentRunner.run(prompt, [], options),
    rt.dreamService,
    transport,
  );
}

export function createTelegramTransport(config: Config, language: string, token: string): TelegramTransport {
  return new TelegramTransport({
    telegramToken: token,
    allowedUsers: config.allowedUsers,
    language,
    botLabel: `${language}-telegram`,
  });
}

export function startTelegramTransport(manager: RuntimeManager, config: Config, language: string, transport: TelegramTransport): void {
  transport.onMessage((chatId, userId, text) => manager.handleMessage(language, Number(chatId), userId, text));
  transport.start({
    onStart: (info: { username: string }) => log.info({ username: info.username, language }, "bot started"),
    allowed_updates: ["message"],
  });
}
