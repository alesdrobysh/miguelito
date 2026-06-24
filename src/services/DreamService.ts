import fs from "fs";
import path from "path";
import type { SessionRepository, ErrorRepository, CompetencyRepository, MetaRepository } from "../repositories/interfaces.js";
import type { LearningHygieneRunResult } from "../domain/types.js";
import type { LLMProvider } from "../providers/interfaces.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'dream' });

interface DreamConfig {
  timezone: string;
  dreamMemoryPath: string;
  dreamSystemPrompt: string;
  morphologyCategories: ReadonlySet<string>;
  langId: string;
}

export class DreamService {
  constructor(
    private session: SessionRepository,
    private errors: ErrorRepository,
    private competency: CompetencyRepository,
    private provider: LLMProvider,
    private config: DreamConfig,
    private meta: MetaRepository,
    private hygiene?: { run(): Promise<LearningHygieneRunResult> },
  ) {}

  async run(): Promise<string> {
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: this.config.timezone }).format(new Date());
      const messages = await this.session.getTodaysMessages(today);

      log.info({ date: today, messageCount: messages.length }, 'dream run start');

      if (messages.length === 0) {
        log.warn('no messages to dream about');
        return "Nothing to dream about today.";
      }

      const transcript = messages.map((m) => `[${m.role}] ${m.content}`).join("\n");

      const memoryDir = path.dirname(this.config.dreamMemoryPath);
      fs.mkdirSync(memoryDir, { recursive: true });

      const existingMemory = fs.existsSync(this.config.dreamMemoryPath)
        ? fs.readFileSync(this.config.dreamMemoryPath, "utf8").trim()
        : "";

      const userPrompt = `Existing profile:\n${existingMemory || "(empty)"}\n\nToday's transcript:\n${transcript}`;

      const result = await this.provider.chat(
        [
          { role: "system", content: this.config.dreamSystemPrompt },
          { role: "user", content: userPrompt },
        ],
        undefined,
        { temperature: 0.3, maxTokens: 2048 },
      );

      const updated = result.content?.trim();
      if (!updated) {
        return "Dream produced no output.";
      }

      fs.writeFileSync(this.config.dreamMemoryPath, updated, "utf8");
      log.info({ wordCount: updated.split(/\s+/).length }, 'memory updated');

      const refinementNotes = await this._runNightlyRefinement();

      await this.meta.setMetaValue(`last_dream_date:${this.config.langId}`, today);

      if (refinementNotes.length > 0) {
        log.info({ refinementNotes }, 'refinement notes');
        const augmented = updated + "\n\n" + refinementNotes.join("\n");
        fs.writeFileSync(this.config.dreamMemoryPath, augmented, "utf8");
        return `Dream complete. Memory updated (${augmented.split(/\s+/).length} words). Refinement: ${refinementNotes.join("; ")}`;
      }

      return `Dream complete. Memory updated (${updated.split(/\s+/).length} words).`;
    } catch (err) {
      log.error({ err }, 'dream error');
      throw err;
    }
  }

  private async _runNightlyRefinement(): Promise<string[]> {
    const notes: string[] = [];

    const recentAnnotations = await this.competency.getRecentAnnotations(500);

    const obligatoryCounts = new Map<string, number>();
    const usedSet = new Set<string>();

    for (const ann of recentAnnotations) {
      try {
        const obligatory: Array<{ type: string }> = JSON.parse(ann.obligatory_json);
        for (const o of obligatory) {
          obligatoryCounts.set(o.type, (obligatoryCounts.get(o.type) ?? 0) + 1);
        }
      } catch {}
      try {
        const used: string[] = JSON.parse(ann.used_json);
        for (const u of used) usedSet.add(u.toLowerCase());
      } catch {}
    }

    const avoidedConstructions: string[] = [];
    for (const [construction, count] of obligatoryCounts.entries()) {
      if (count >= 5 && !usedSet.has(construction.toLowerCase())) {
        avoidedConstructions.push(`${construction} (required ${count}× but never self-initiated)`);
      }
    }
    if (avoidedConstructions.length > 0) {
      notes.push(`Avoidance pattern: ${avoidedConstructions.join(", ")}.`);
    }

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    const recentErrors = await this.errors.listRecentErrors(fourteenDaysAgo);
    const recentErrorCategories = new Set(recentErrors.map((e) => e.category));

    for (const [type, count] of obligatoryCounts.entries()) {
      if (this.config.morphologyCategories.has(type) && count >= 5 && !recentErrorCategories.has(type)) {
        notes.push(`${type} appears stable — no errors in the last 14 days with ${count} obligatory contexts.`);
      }
    }

    const vec = await this.competency.getCompetencyVector();
    if (vec.morph_obs > 50 && vec.morph_trials < 0.05 && vec.morph_trials > 0) {
      const rate = vec.morph_successes / vec.morph_trials;
      await this.competency.updateCompetencyVector({ morph_successes: rate * 2, morph_trials: 2 });
      notes.push("Morphology EWMA recalibrated after idle period.");
    }
    if (vec.idiom_obs > 50 && vec.idiom_trials < 0.05 && vec.idiom_trials > 0) {
      const rate = vec.idiom_successes / vec.idiom_trials;
      await this.competency.updateCompetencyVector({ idiom_successes: rate * 2, idiom_trials: 2 });
      notes.push("Idiomaticity EWMA recalibrated after idle period.");
    }

    if (this.hygiene) {
      const result = await this.hygiene.run();
      const total = result.archived + result.cooledDown + result.promoted + result.mastered + result.ignored;
      if (total > 0) {
        notes.push(`Learning hygiene: archived ${result.archived}, cooled ${result.cooledDown}, promoted ${result.promoted}, mastered ${result.mastered}, ignored ${result.ignored}.`);
      }
    }

    return notes;
  }
}
