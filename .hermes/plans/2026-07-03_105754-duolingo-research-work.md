# Duolingo Research Work Plan for Miguelito

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the Obsidian Duolingo APK research notes into a small, high-leverage Miguelito implementation roadmap without copying Duolingo-scale mechanics that do not fit a personal Telegram tutor.

**Architecture:** Keep Miguelito conversation-first: ordinary chat remains primary, while review/scenario/progress features reuse existing `learning_items`, `learning_item_evidence`, turn annotations, and post-turn evaluator output. Prefer config/data and pure functions over new services; avoid new tables unless existing state cannot represent the behavior safely.

**Tech Stack:** TypeScript, Vitest, SQL.js, existing Miguelito repositories/tools/runtime, local data at `data/buddy.db`.

---

## Source notes used

Authoritative Obsidian/CouchDB source:

- `Projects/miguelito/duolingo-research/10-miguelito-ts-overview.md`
- `Projects/miguelito/duolingo-research/11-miguelito-roleplay-scenarios.md`
- `Projects/miguelito/duolingo-research/12-miguelito-error-severity-routing.md`
- `Projects/miguelito/duolingo-research/13-miguelito-decay-visibility.md`
- `Projects/miguelito/duolingo-research/14-miguelito-quick-review-mode.md`
- `Projects/miguelito/duolingo-research/15-miguelito-reactivation-tone.md`
- `Projects/miguelito/duolingo-research/16-miguelito-precompute-explanations.md`
- `Projects/miguelito/duolingo-research/17-miguelito-cefr-presentation.md`
- `Projects/miguelito/duolingo-research/18-miguelito-what-to-skip.md`
- `Projects/miguelito/duolingo-research/20-llm-architecture-patterns.md`
- `Projects/miguelito/duolingo-research/21-testing-and-validation.md`
- `Projects/miguelito/duolingo-research/22-llm-async-evaluator-split.md`
- `Projects/miguelito/duolingo-research/23-memory-consolidation-dreaming.md`

Current repo context checked:

- `/data/data/com.termux/files/home/miguelito`
- Branch: `main...origin/main`
- Current untracked file exists: `.mig_quality.sql` — do not delete or commit unless explicitly reviewed.
- `/drill` already exists in `src/runtime.ts`.
- Conversation planner exists in `src/agent/ConversationPlanner.ts`.
- Async evaluator split exists in `src/agent/AgentRunner.ts` and `src/agent/PostTurnProcessor.ts`.
- Progress summary exists in `src/tools/progress.ts`.
- Error explanations already exist in `src/languages/spanish/config.ts`.
- Competency vector already uses observed behavior and frequency/rarity in `src/domain/competency.ts`.

---

## Product filter: what NOT to build

Do not copy Duolingo features that solve Duolingo-scale business problems rather than this user's learning problem.

Skip:

- Leagues, XP competition, streak pressure, gems/hearts, paywalls, churn ML.
- A dashboard/app/CRM layer.
- A Duolingo-style CEFR badge as the only metric, or as a gamified status badge.
- A 25-state roleplay machine.
- Any new dependency unless a task proves it cannot be done with current code/stdlib.

Updated user preference: add a user-facing CEFR estimate because it gives a familiar reference point, but make it explicitly an estimate derived from observed behavior. It must be paired with a detailed axis-by-axis breakdown from the metrics Miguelito already tracks: lexicon/frequency, syntax, morphology, idiomaticity, reception, self-correction/monitoring, passive vs active production. CEFR is the headline summary, not the source of truth.

---

## Recommended priority order

1. P0: Safety baseline and backups.
2. P1: Make forgetting/review visible with concrete due examples.
3. P1: Improve `/drill` completion summary and selection from due items.
4. P2: Add error severity as internal routing metadata, not immediate current-turn correction.
5. P2: Add gentle reactivation tone for cron after pauses.
6. P3: Add tiny roleplay scenarios only after review loop is solid.
7. P3: Add validated CEFR estimate plus detailed observed-axis breakdown.
8. Keep existing async evaluator/dream architecture; only harden with tests/metrics.

---

### Task 1: Baseline safety snapshot before feature work

**Objective:** Make implementation safe against live data loss and know whether the repo is already green.

**Files:**
- Read only: `package.json`
- Read only: `data/buddy.db`
- Do not modify code in this task.

**Step 1: Inspect worktree**

Run:

```bash
git status --short --branch
```

Expected: note any untracked/modified files. Preserve `.mig_quality.sql` unless separately explained.

**Step 2: Back up live DB**

Run:

```bash
mkdir -p backups
cp data/buddy.db backups/buddy.$(date +%Y%m%d-%H%M%S).db
```

Expected: one new backup file under `backups/`.

**Step 3: Run baseline checks**

Run:

```bash
npm test
npm run build
```

Expected: both pass before feature changes. If not, stop and record failures; do not stack new work on a broken baseline.

**Step 4: Commit only if backup/check metadata is intentionally tracked**

Normally no commit for this task. DB backups are safety artifacts, not feature code.

---

### Task 2: Add concrete “rusty examples” to progress summary

**Objective:** Implement note 13's best low-risk idea: show concrete things worth refreshing, not only counts.

**Files:**
- Modify: `src/tools/progress.ts`
- Test: `src/tools/annotate.test.ts` or create focused `src/tools/progress.test.ts` if no existing progress test fits.

**Step 1: Write failing test**

Add a focused test that constructs a fake `ToolContext` where:

- `ctx.learning.listLearningItems("active", 1000)` returns active items.
- `ctx.learning.listDueLearningItems(1000)` returns due items with titles and `reactivation_pressure` values.
- `ctx.learning.getLearningHygieneSnapshot()` returns `due_high_pressure > 0`.

Assert the tool output includes:

```ts
expect(result.hygiene.rusty_examples).toEqual(["por vs para", "me da igual"]);
```

Keep it deterministic: sort high/medium/low explicitly rather than `Number("high")`.

**Step 2: Run test to verify failure**

Run:

```bash
npx vitest run src/tools/progress.test.ts
```

Expected: FAIL because `rusty_examples` does not exist.

**Step 3: Add minimal implementation**

In `src/tools/progress.ts`, near `dueItems`, add:

```ts
const pressureRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
const rustyExamples = dueItems
  .slice()
  .sort((a, b) =>
    (pressureRank[String(b.reactivation_pressure)] ?? 0) -
    (pressureRank[String(a.reactivation_pressure)] ?? 0) ||
    (b.priority - a.priority) ||
    (a.id - b.id),
  )
  .slice(0, 5)
  .map((i) => i.title);
```

Then add under `hygiene`:

```ts
rusty_examples: rustyExamples,
```

**Step 4: Run focused and full checks**

Run:

```bash
npx vitest run src/tools/progress.test.ts
npm test
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/tools/progress.ts src/tools/progress.test.ts
git commit -m "feat: show concrete rusty learning items in progress"
```

---

### Task 3: Make `/drill` select due/high-pressure items first

**Objective:** Turn `/drill` into quick review over the same learning data, prioritizing due/reactivation pressure before generic low-evidence items.

**Files:**
- Modify: `src/runtime.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write failing test**

In `src/runtime.test.ts`, add a test that creates at least three items:

- one due/high-pressure old item with evidence,
- one active high-priority but not due item,
- one low-evidence candidate.

Call `/drill` and assert the due/high-pressure item appears first.

Expected assertion shape:

```ts
expect(drill.indexOf("por vs para")).toBeLessThan(drill.indexOf("new shiny phrase"));
```

**Step 2: Run test to verify failure**

```bash
npx vitest run src/runtime.test.ts -t "drill"
```

Expected: FAIL if current sort by `evidence_count`/`priority` picks the wrong item.

**Step 3: Implement the lazy sort**

In `handleDrillCommand`, replace `const all = await db.listLearningItems("all", 100);` sorting with a tiny helper:

```ts
const pressureRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
const due = await db.listDueLearningItems(100);
const dueIds = new Set(due.map((i) => i.id));
const all = await db.listLearningItems("all", 100);
```

Sort by:

1. due first,
2. pressure rank desc,
3. lower evidence count,
4. higher priority,
5. older id.

No new service.

**Step 4: Run checks**

```bash
npx vitest run src/runtime.test.ts -t "drill"
npm test
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/runtime.ts src/runtime.test.ts
git commit -m "feat: prioritize due items in drill"
```

---

### Task 4: Add a short `/drill` completion summary

**Objective:** Implement the useful part of note 14: after a drill round, tell the learner what was marked and what remains, without adding LLM grading yet.

**Files:**
- Modify: `src/runtime.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write failing test**

Extend the existing `/drill` answer-flow tests. After completing all active attempts, assert the final reply includes:

- completed count,
- at least one practiced title,
- no internal terms like `learning item`.

Example:

```ts
expect(reply).toContain("Drill completado");
expect(reply).toContain("opciones");
expect(reply).not.toMatch(/learning item|evidence/i);
```

**Step 2: Run failure**

```bash
npx vitest run src/runtime.test.ts -t "Drill completado"
```

Expected: FAIL because current summary only says count.

**Step 3: Implement minimal summary**

In `processDrillAnswers`, collect completed item titles:

```ts
const completedTitles: string[] = [];
```

Push `drillTarget(item)` after successful completion. On no remaining attempts, return:

```ts
return [
  `¡Bien! He marcado ${completed} ${noun}. Drill completado.`,
  completedTitles.length ? `Practicaste: ${completedTitles.slice(0, 3).join(", ")}.` : "",
].filter(Boolean).join("\n");
```

This is intentionally not fuzzy/LLM grading yet.

**Step 4: Run checks**

```bash
npx vitest run src/runtime.test.ts -t "drill"
npm test
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/runtime.ts src/runtime.test.ts
git commit -m "feat: summarize completed drill rounds"
```

---

### Task 5: Add error severity config as internal metadata

**Objective:** Implement note 12's safe foundation: categorize error severity for prioritization and reporting, without trying to rewrite the current assistant reply from async post-turn processing.

**Files:**
- Modify: `src/languages/LanguageConfig.ts`
- Modify: `src/languages/spanish/config.ts`
- Modify: `src/agent/PostTurnProcessor.ts`
- Test: `src/languages/index.test.ts` or `src/agent/PostTurnProcessor.test.ts`

**Important architecture constraint:** `PostTurnProcessor` is fire-and-forget after the assistant reply (`AgentRunner.scheduleAgentPostTurn`). It cannot append corrections to the reply that was already sent unless the architecture is changed. For now, use severity to tag `ErrorItem.note` and learning item priority; visible current-turn behavior can come later through prompt context/next-turn reinforcement.

**Step 1: Write failing config test**

Assert every Spanish `errorCategories` entry has a severity.

```ts
for (const category of SpanishLanguage.errorCategories) {
  expect(SpanishLanguage.errorSeverity[category]).toMatch(/^(cosmetic|notable|critical)$/);
}
```

**Step 2: Run failure**

```bash
npx vitest run src/languages/index.test.ts
```

Expected: FAIL because `errorSeverity` does not exist.

**Step 3: Add config type and Spanish mapping**

In `src/languages/LanguageConfig.ts` add:

```ts
export type ErrorSeverity = "cosmetic" | "notable" | "critical";
```

and in `LanguageConfig`:

```ts
errorSeverity: Record<string, ErrorSeverity>;
```

In `src/languages/spanish/config.ts`, add mapping:

```ts
errorSeverity: {
  spelling: "cosmetic",
  false_cognate: "notable",
  word_choice: "notable",
  preposition: "notable",
  object_pronoun_order: "notable",
  gender: "critical",
  agreement: "critical",
  verb_conjugation: "critical",
  ser_estar: "critical",
  por_para: "critical",
  subjunctive_avoidance: "critical",
  preterite_imperfect: "critical",
  other: "notable",
},
```

**Step 4: Add severity to logged error notes**

In `PostTurnProcessor.apply`, before `logError`, compute:

```ts
const severity = this.deps.lang.errorSeverity[category] ?? "notable";
const note = [this.clean(item.note), `severity:${severity}`].filter(Boolean).join(" | ");
await this.deps.errors.logError(userText, correct, category, note);
```

For learning item priority, set correction priority based on severity:

```ts
const correctionPriority = severity === "critical" ? 0.95 : severity === "notable" ? 0.8 : 0.55;
```

Use it where correction learning items are created.

**Step 5: Test post-turn application**

Add/adjust `PostTurnProcessor.test.ts` to verify a `gender` error is logged with `severity:critical` and higher priority than a `spelling` error.

**Step 6: Run checks**

```bash
npx vitest run src/agent/PostTurnProcessor.test.ts src/languages/index.test.ts
npm test
npm run build
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/languages/LanguageConfig.ts src/languages/spanish/config.ts src/agent/PostTurnProcessor.ts src/agent/PostTurnProcessor.test.ts src/languages/index.test.ts
git commit -m "feat: track severity for Spanish errors"
```

---

### Task 6: Expose severity/rusty context to the next normal reply, not the previous one

**Objective:** Make severity useful in conversation flow while respecting the async evaluator architecture.

**Files:**
- Modify: `src/agent/PromptBuilder.ts`
- Test: `src/agent/PromptBuilder.test.ts`

**Step 1: Inspect current prompt context**

Read `src/agent/PromptBuilder.ts` and find where `errorInfo` / weak areas are passed into `lang.promptText.currentLearnerProfile`.

**Step 2: Write failing test**

Create a prompt builder test where recent error info contains a note with `severity:critical`. Assert the built prompt includes a concise instruction like:

```text
Prioriza una corrección breve si reaparece este patrón.
```

Do not expose `severity:critical` literally to visible output.

**Step 3: Implement minimal prompt hint**

Parse `severity:` from the latest error note in `PromptBuilder`, and include a system-only hint. Keep it short and generic.

Do not change visible Spanish output templates yet.

**Step 4: Run checks**

```bash
npx vitest run src/agent/PromptBuilder.test.ts
npm test
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/agent/PromptBuilder.ts src/agent/PromptBuilder.test.ts
git commit -m "feat: use error severity in tutor prompt context"
```

---

### Task 7: Add gentle reactivation tone for cron after pauses

**Objective:** Implement note 15 without churn prediction: cron openings should sound different after a multi-day pause.

**Files:**
- Modify: `src/services/Scheduler.ts`
- Modify: `src/runtime.ts` or startup wiring if needed
- Modify: `src/infrastructure/config.ts`
- Test: `src/services/Scheduler.test.ts` if created, or existing scheduler/startup tests.

**Step 1: Check existing config wiring**

Read `src/infrastructure/config.ts` and `src/app/startup.ts` to see how `morningCronPrompt` and `eveningCronPrompt` are built from `LanguageConfig.prompts`.

**Step 2: Write failing pure-function test**

Extract or create a pure function in `Scheduler.ts`:

```ts
export function selectCronPrompt(args: {
  normalPrompt: string;
  shortReactivationPrompt: string;
  longReactivationPrompt: string;
  daysSinceLastUserMessage: number | null;
}): string
```

Test:

- null/0/1/2 days -> normal,
- 3-7 days -> short,
- >7 days -> long.

**Step 3: Add language prompts**

In `LanguageConfig.prompts`, add optional or required:

```ts
reactivationShort: string;
reactivationLong: string;
```

In Spanish config, keep visible text Spanish-only, gentle, and no guilt:

- short: “Retoma con una pregunta muy fácil y cálida.”
- long: “No menciones la ausencia como problema; ofrece una entrada ligera.”

**Step 4: Track last user activity cheaply**

Use existing meta repository if already exposed to runtime; otherwise, do the laziest safe thing: query the most recent user chat message from the existing session repository. Avoid schema migration unless there is no query available.

If adding metadata update is simpler, update it in `RuntimeManager.handleMessage` immediately after user messages:

```ts
await db.setMetaValue("last_user_message_at", new Date().toISOString());
```

Only if `BuddyDb` already exposes meta methods. Do not add a new table.

**Step 5: Wire scheduler prompt selection**

Before `agentRunner(prompt, { sourceType: "cron" })`, select prompt based on the computed gap.

**Step 6: Run checks**

```bash
npx vitest run src/services/Scheduler.test.ts src/app/startup.test.ts src/runtime.test.ts
npm test
npm run build
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/services/Scheduler.ts src/infrastructure/config.ts src/languages/LanguageConfig.ts src/languages/spanish/config.ts src/runtime.ts src/services/Scheduler.test.ts src/app/startup.test.ts
git commit -m "feat: soften cron tone after learner pauses"
```

---

### Task 8: Add a tiny scenario catalog, but do not enable full roleplay yet

**Objective:** Start note 11 with data only. This avoids prematurely adding state machine complexity.

**Files:**
- Create: `src/languages/spanish/scenarios.ts`
- Create: `src/languages/spanish/scenarios.test.ts`
- Optionally export from: `src/languages/spanish/index.ts`

**Step 1: Write test for catalog quality**

Assert:

- every scenario has stable `id`, `title`, `setup_l1`, `opening_line_l2`, `maxTurns`,
- `maxTurns` is between 4 and 8,
- ids are unique,
- no scenario mentions internal terms.

**Step 2: Add 5 scenarios only**

Create minimal scenarios matching Miguelito use cases:

- pedir comida,
- preguntar por una ruta,
- hablar de entrenamiento,
- contar un plan de fin de semana,
- resolver un malentendido pequeño.

Do not add active state yet.

**Step 3: Run checks**

```bash
npx vitest run src/languages/spanish/scenarios.test.ts
npm test
npm run build
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/languages/spanish/scenarios.ts src/languages/spanish/scenarios.test.ts src/languages/spanish/index.ts
git commit -m "feat: add Spanish micro-scenario catalog"
```

---

### Task 9: Add `/scenario` as an explicit command only

**Objective:** Let the user opt into a short scenario. Do not auto-steer normal chat into scenarios.

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/domain/types.ts` only if types are needed
- Modify: `src/infrastructure/schema.ts` and migrations only if existing conversation state cannot store scenario state.
- Test: `src/runtime.test.ts`

**Step 1: Prefer no schema migration**

First check whether `ConversationStateData.last_mode` or `topics_touched` can safely hold a small explicit scenario state. If not, add the smallest migration: `active_scenario_id TEXT NULL`, `scenario_turn_index INTEGER DEFAULT 0` to conversation state.

**Step 2: Write failing command test**

`/scenario` should list 3-5 scenario titles.

`/scenario pedir_comida` should reply with the scenario setup and opening line.

Normal chat must not trigger scenarios.

**Step 3: Implement command branch**

In `RuntimeManager.handleCommand`, add `/scenario` before generic slash redirect. Keep all visible text Spanish.

**Step 4: Add ConversationPlanner branch only for active scenario**

In `buildConversationPlan`, accept optional scenario state. If active:

- opening/development/closing based on turn index,
- never expose state names,
- force closure at maxTurns.

**Step 5: Run checks**

```bash
npx vitest run src/runtime.test.ts src/agent/ConversationPlanner.test.ts
npm test
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/runtime.ts src/agent/ConversationPlanner.ts src/runtime.test.ts src/agent/ConversationPlanner.test.ts
git commit -m "feat: add explicit micro-scenario practice"
```

---

### Task 10: Add CEFR estimate plus observed-axis breakdown

**Objective:** Adapt note 17 into a user-facing proficiency report: a familiar CEFR estimate as the headline, backed by the observed metrics Miguelito already tracks.

**Files:**
- Modify: `src/domain/competency.ts`
- Modify: `src/tools/progress.ts`
- Test: create `src/domain/competency.test.ts` if missing
- Test: `src/tools/progress.test.ts`

**Product rule:** CEFR is an approximate label for human readability, not the internal truth. The report must always include axis details so the user can see *why* Miguelito estimates that level.

**Step 1: Define explicit output types**

In `src/domain/competency.ts`, add types like:

```ts
export type CefrEstimate = "insufficient_data" | "A1" | "A2" | "B1" | "B2" | "C1";

export interface CompetencyAxisEstimate {
  label: string;
  score: number | null;
  confidence: Confidence;
  evidence: string;
  interpretation: string;
}

export interface ProficiencyEstimate {
  cefr: CefrEstimate;
  confidence: Confidence;
  summary: string;
  axes: {
    lexicon: CompetencyAxisEstimate;
    syntax: CompetencyAxisEstimate;
    morphology: CompetencyAxisEstimate;
    idiomaticity: CompetencyAxisEstimate;
    reception: CompetencyAxisEstimate;
    monitoring: CompetencyAxisEstimate;
  };
  caveats: string[];
}
```

Keep `C1` as the top label for now unless data genuinely supports C2. This is a personal tutor estimate, not an exam certifier.

**Step 2: Write failing tests for low-confidence and high-confidence cases**

In `src/domain/competency.test.ts`, test:

- low confidence on key axes returns `cefr: "insufficient_data"`,
- a stronger vector returns a plausible CEFR label,
- the result includes all axis keys,
- every axis has `confidence`, `evidence`, and `interpretation`,
- caveats mention that this is an estimate from observed chat behavior.

Example assertions:

```ts
const estimate = estimateProficiency(strongVector);
expect(estimate.cefr).toMatch(/A2|B1|B2|C1/);
expect(Object.keys(estimate.axes)).toEqual([
  "lexicon", "syntax", "morphology", "idiomaticity", "reception", "monitoring",
]);
expect(estimate.axes.lexicon.evidence).toContain("rarity");
expect(estimate.caveats.join(" ")).toMatch(/estimate|observed/i);
```

**Step 3: Implement pure function**

In `src/domain/competency.ts`:

```ts
export function estimateProficiency(v: CompetencyVector): ProficiencyEstimate
```

Use existing fields:

- `lexicon.lexicalRarity` and frequency-band reception evidence,
- `syntax.meanTunitLength`, `syntax.subIndex`, `syntax.confidence`,
- `morphology.rate`, `morphology.obs`, `morphology.confidence`,
- `idiomaticity.rate`, `idiomaticity.obs`, `idiomaticity.confidence`,
- `reception.level`, `reception.byFrequencyBand`, `reception.confidence`,
- `monitoring.selfCorrectionObs`.

Suggested lazy heuristic:

```ts
if (v.morphology.confidence === "low" || v.syntax.confidence === "low" || v.reception.confidence === "low") {
  return insufficient_data_with_axes;
}

const score =
  v.morphology.rate * 0.22 +
  v.idiomaticity.rate * 0.18 +
  Math.min(v.syntax.meanTunitLength / 12, 1) * 0.18 +
  v.syntax.subIndex * 0.12 +
  v.reception.level * 0.20 +
  Math.min(v.lexicon.lexicalRarity, 1) * 0.10;

if (score < 0.28) cefr = "A1";
else if (score < 0.46) cefr = "A2";
else if (score < 0.66) cefr = "B1";
else if (score < 0.82) cefr = "B2";
else cefr = "C1";
```

Ponytail: this is a coarse heuristic; upgrade path is calibration against real placement-test samples and/or teacher-rated conversations.

**Step 4: Add human-readable axis interpretations**

For each axis, provide compact explanations such as:

- Lexicon: “uses mostly common / mid-frequency / rarer words; avg rarity signal X”.
- Syntax: “mostly simple / varied / complex sentences; T-unit mean X, subordination Y%”.
- Morphology: “accuracy X% over N observations”.
- Idiomaticity: “naturalness X% over N observations”.
- Reception: “understands bot output at current difficulty X%; frequency-band evidence: ...”.
- Monitoring: “self-corrections observed N times”.

Do not overstate precision.

**Step 5: Add to progress tool**

In `src/tools/progress.ts`, import `estimateProficiency` and add under `competency`:

```ts
proficiency: estimateProficiency(cv),
```

Keep existing raw metrics (`summary`, `morph_accuracy`, `syntax_tunit_mean`, etc.) for debugging/backwards compatibility.

**Step 6: Add progress tool test**

In `src/tools/progress.test.ts`, assert `miguelito_progress_summary` returns:

```ts
expect(result.competency.proficiency.cefr).toBeTruthy();
expect(result.competency.proficiency.axes.morphology.interpretation).toContain("accuracy");
expect(result.competency.proficiency.caveats.length).toBeGreaterThan(0);
```

**Step 7: Run checks**

```bash
npx vitest run src/domain/competency.test.ts src/tools/progress.test.ts
npm test
npm run build
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/domain/competency.ts src/domain/competency.test.ts src/tools/progress.ts src/tools/progress.test.ts
git commit -m "feat: estimate CEFR with observed competency axes"
```

---

### Task 11: Add validation metrics report for the new features

**Objective:** Implement note 21's “prove it worked” layer with SQL/reporting, not dashboard UI.

**Files:**
- Create: `scripts/report-learning-metrics.ts`
- Test: optional minimal self-check inside the script or a small Vitest test if script logic is extracted.
- Output: `reports/learning-metrics.md` when run manually.

**Step 1: Keep it local and manual**

No scheduler. No dashboard. Script only.

**Step 2: Report the smallest useful metrics**

Include:

- `/drill` attempts started/completed/abandoned,
- average grade,
- items with `rusty_examples` shown and later practiced if trackable,
- critical/notable/cosmetic error counts from `ErrorItem.note`,
- learning items by status,
- proficiency evidence by frequency band.

**Step 3: Add command docs**

Add script to `package.json` only if useful:

```json
"report:learning": "tsx scripts/report-learning-metrics.ts"
```

**Step 4: Run checks**

```bash
npm run report:learning
npm test
npm run build
```

Expected: report generated, checks pass.

**Step 5: Commit**

```bash
git add scripts/report-learning-metrics.ts package.json reports/.gitkeep
git commit -m "chore: add learning metrics report"
```

Do not commit generated personal report content unless the repo already tracks such reports intentionally.

---

## Deferred ideas

Defer until the above is used for at least a few real sessions:

- Fuzzy/LLM grading inside `/drill`: current exact/normalized target check is cheap and testable. Add LLM only if false negatives are common.
- Scenario completion report: needs scenario session boundaries first.
- Specific “explain this exact error” EMA escalation: useful, but only after severity and prompt context show repeated confusion.
- Cron injection of rusty examples: potentially good, but first verify `rusty_examples` in progress and `/drill` actually helps.
- CEFR-only UX: the CEFR estimate is now in scope, but only with caveats and observed-axis evidence. Do not show a naked `B1` without the breakdown.

---

## Verification before live restart

After each implemented task:

```bash
npm test
npm run build
```

Before touching live state:

```bash
cp data/buddy.db backups/buddy.$(date +%Y%m%d-%H%M%S).db
```

Before restarting live bot:

```bash
pgrep -af '[n]ode dist/index.js'
```

After restart, verify process and smoke-test in `ENV=test` first when the change affects runtime behavior.

---

## Success criteria

This work is successful if:

- Miguelito remains chat-first and Spanish-only in visible learner UX.
- `/drill` becomes more useful without becoming a separate app.
- Progress surfaces concrete next practice targets.
- Error handling becomes more selective without grammar-lecture spam.
- Reactivation messages are gentle after pauses.
- Scenarios are explicit opt-in, short, and bounded.
- Metrics remain based on observed behavior and frequency/rarity; CEFR is a familiar estimate layered on top, always accompanied by axis-by-axis evidence.
