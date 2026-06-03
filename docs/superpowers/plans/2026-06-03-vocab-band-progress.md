# Vocab Band in Progress Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user's typical production vocabulary band (e.g. "Top 3k") in the Perfil tab's Progreso section, replacing the existing Morfología and Fluidez cards.

**Architecture:** Add `getTypicalVocabBand(limit)` to the `CompetencyRepository` interface and implement it in `SqlCompetencyRepository` via a weighted-mode SQL query. Wire it into `PerfilData` in `AppContext`, then update `SettingsDrawer` to show a single "Vocabulario" card.

**Tech Stack:** TypeScript, sql.js (SQLite in browser), React + Tailwind (web UI), Vitest (tests)

---

### Task 1: Add `getTypicalVocabBand` to `CompetencyRepository` interface

**Files:**
- Modify: `src/repositories/interfaces.ts`

- [ ] **Step 1: Add the method signature**

In `src/repositories/interfaces.ts`, add to the `CompetencyRepository` interface after the `listProficiencyEvidence` line:

```ts
getTypicalVocabBand(limit: number): Promise<ProficiencyChallengeBand | null>;
```

The `ProficiencyChallengeBand` type is already imported in this file (it's exported from `../domain/types.js` alongside `ProficiencyEvidenceInput`). Verify the import includes it — the current import block at the top already pulls `ProficiencyEvidenceInput` and `ProficiencyEvidenceRow`; add `ProficiencyChallengeBand` if not present:

```ts
import {
  // ... existing imports ...
  ProficiencyChallengeBand,
} from "../domain/types.js";
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ales/workspace/personal/miguelito-ts && npx tsc --noEmit 2>&1 | head -20
```

Expected: errors only about `getTypicalVocabBand` not implemented yet (or none if TS is lenient about interface-only additions). Any other errors are pre-existing.

---

### Task 2: Implement `getTypicalVocabBand` in `SqlCompetencyRepository`

**Files:**
- Modify: `src/infrastructure/repositories/competencyRepository.ts`

- [ ] **Step 1: Write the failing test first**

In `src/db.test.ts`, inside the `"BuddyDb turn annotations and competency vector"` describe block, add after the existing proficiency evidence test (around line 699):

```ts
it("getTypicalVocabBand returns weighted-mode band from production evidence", async () => {
  // Insert 3 production entries: two top_3k (weights 1.5 + 1.2 = 2.7), one top_10k (weight 2.0)
  await db.insertProficiencyEvidence({
    skill: "production",
    dimension: "lexical",
    challenge_band: "top_3k",
    outcome: "success",
    confidence: 0.8,
    weight: 1.5,
    evidence_text: "produced top_3k vocab",
    challenge_json: "{}",
  });
  await db.insertProficiencyEvidence({
    skill: "production",
    dimension: "lexical",
    challenge_band: "top_10k",
    outcome: "success",
    confidence: 0.7,
    weight: 2.0,
    evidence_text: "produced top_10k vocab",
    challenge_json: "{}",
  });
  await db.insertProficiencyEvidence({
    skill: "production",
    dimension: "lexical",
    challenge_band: "top_3k",
    outcome: "partial",
    confidence: 0.6,
    weight: 1.2,
    evidence_text: "produced top_3k vocab again",
    challenge_json: "{}",
  });

  const band = await db.getTypicalVocabBand(50);
  // top_3k total weight = 2.7, top_10k = 2.0 → top_3k wins
  expect(band).toBe("top_3k");
});

it("getTypicalVocabBand returns null when no production evidence exists", async () => {
  // Insert only a reception entry — should not count
  await db.insertProficiencyEvidence({
    skill: "reception",
    dimension: "lexical",
    challenge_band: "top_1k",
    outcome: "success",
    confidence: 0.9,
    weight: 1.0,
    evidence_text: "received top_1k",
    challenge_json: "{}",
  });

  const band = await db.getTypicalVocabBand(50);
  expect(band).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ales/workspace/personal/miguelito-ts && npx vitest run src/db.test.ts 2>&1 | tail -20
```

Expected: 2 failures — `db.getTypicalVocabBand is not a function` or similar.

- [ ] **Step 3: Implement `getTypicalVocabBand`**

In `src/infrastructure/repositories/competencyRepository.ts`, add after `listProficiencyEvidence`:

```ts
async getTypicalVocabBand(limit: number): Promise<ProficiencyChallengeBand | null> {
  const row = this.queryRow(
    `SELECT challenge_band
     FROM (
       SELECT challenge_band, weight
       FROM proficiency_evidence
       WHERE language = ? AND skill = 'production'
       ORDER BY id DESC LIMIT ?
     )
     GROUP BY challenge_band
     ORDER BY SUM(weight) DESC
     LIMIT 1`,
    [this.languageId, limit]
  ) as { challenge_band: string } | undefined;
  return row ? (row.challenge_band as ProficiencyChallengeBand) : null;
}
```

Add the `ProficiencyChallengeBand` import to the top of the file:

```ts
import type {
  CompetencyVectorRow,
  ProficiencyChallengeBand,
  ProficiencyEvidenceInput,
  ProficiencyEvidenceRow,
  TurnAnnotation,
  TurnAnnotationInput,
} from "../../domain/types.js";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/ales/workspace/personal/miguelito-ts && npx vitest run src/db.test.ts 2>&1 | tail -20
```

Expected: all tests pass including the two new ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/ales/workspace/personal/miguelito-ts && git add src/repositories/interfaces.ts src/infrastructure/repositories/competencyRepository.ts src/db.test.ts && git commit -m "feat: add getTypicalVocabBand to CompetencyRepository"
```

---

### Task 3: Add `vocabBand` to `PerfilData` and load it

**Files:**
- Modify: `web/src/context/AppContext.tsx`

- [ ] **Step 1: Add `vocabBand` to the `PerfilData` interface**

In `web/src/context/AppContext.tsx`, find the `PerfilData` interface (around line 38):

```ts
export interface PerfilData {
  errors: ErrorItem[]
  interests: string[]
  competency: CompetencyVectorRow
  soul: string
}
```

Change it to:

```ts
export interface PerfilData {
  errors: ErrorItem[]
  interests: string[]
  competency: CompetencyVectorRow
  soul: string
  vocabBand: import('../../../src/domain/types.js').ProficiencyChallengeBand | null
}
```

Actually, add the import at the top of the file instead. Find the existing import from `'../../../src/domain/types.js'`:

```ts
import type { ErrorItem, CompetencyVectorRow } from '../../../src/domain/types.js'
```

Change it to:

```ts
import type { ErrorItem, CompetencyVectorRow, ProficiencyChallengeBand } from '../../../src/domain/types.js'
```

Then update the interface:

```ts
export interface PerfilData {
  errors: ErrorItem[]
  interests: string[]
  competency: CompetencyVectorRow
  soul: string
  vocabBand: ProficiencyChallengeBand | null
}
```

- [ ] **Step 2: Load `vocabBand` in `loadPerfilData`**

Find the `loadPerfilData` function (around line 101):

```ts
async function loadPerfilData(runtime: RuntimeManager): Promise<PerfilData> {
  const rt = runtime.runtime('spanish')
  const [errors, interests, competency, soul] = await Promise.all([
    rt.db.listErrors('all', 10),
    rt.db.listInterests(20),
    rt.db.getCompetencyVector(),
    import('../browser-shims/fs').then(fs => (fs.readFileSync(DREAM_PATH, 'utf8') as string) || 'No hay memoria aún.'),
  ])
  return { errors, interests, competency, soul }
}
```

Change it to:

```ts
async function loadPerfilData(runtime: RuntimeManager): Promise<PerfilData> {
  const rt = runtime.runtime('spanish')
  const [errors, interests, competency, soul, vocabBand] = await Promise.all([
    rt.db.listErrors('all', 10),
    rt.db.listInterests(20),
    rt.db.getCompetencyVector(),
    import('../browser-shims/fs').then(fs => (fs.readFileSync(DREAM_PATH, 'utf8') as string) || 'No hay memoria aún.'),
    rt.db.getTypicalVocabBand(50),
  ])
  return { errors, interests, competency, soul, vocabBand }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/ales/workspace/personal/miguelito-ts/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors (there may be a TS error in SettingsDrawer about `competency` being referenced but that's fine — will be fixed in Task 4).

- [ ] **Step 4: Commit**

```bash
cd /Users/ales/workspace/personal/miguelito-ts && git add web/src/context/AppContext.tsx && git commit -m "feat: add vocabBand to PerfilData"
```

---

### Task 4: Update SettingsDrawer UI

**Files:**
- Modify: `web/src/molecules/SettingsDrawer.tsx`

- [ ] **Step 1: Replace Morfología/Fluidez cards with Vocabulario card**

Find the "Competencia" / "Progreso" section (around line 542). The current code is:

```tsx
{/* Competencia */}
{perfilData?.competency && (
  <div>
    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Progreso</p>
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-border p-3">
        <p className="text-[10px] font-bold uppercase tracking-tight text-text-tertiary">Morfología</p>
        <p className="text-lg font-semibold text-text-primary">
          {perfilData.competency.morph_trials > 0
            ? `${Math.round((perfilData.competency.morph_successes / perfilData.competency.morph_trials) * 100)}%`
            : '-%'}
        </p>
      </div>
      <div className="rounded-lg border border-border p-3">
        <p className="text-[10px] font-bold uppercase tracking-tight text-text-tertiary">Fluidez</p>
        <p className="text-lg font-semibold text-text-primary">
          {perfilData.competency.idiom_trials > 0
            ? `${Math.round((perfilData.competency.idiom_successes / perfilData.competency.idiom_trials) * 100)}%`
            : '-%'}
        </p>
      </div>
    </div>
  </div>
)}
```

Replace the entire block with:

```tsx
{/* Vocabulario */}
{'vocabBand' in (perfilData ?? {}) && (
  <div>
    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Progreso</p>
    <div className="rounded-lg border border-border p-3">
      <p className="text-[10px] font-bold uppercase tracking-tight text-text-tertiary">Vocabulario</p>
      <p className="text-lg font-semibold text-text-primary">
        {VOCAB_BAND_LABELS[perfilData!.vocabBand ?? ''] ?? '—'}
      </p>
    </div>
  </div>
)}
```

- [ ] **Step 2: Add the band label map**

Add the constant near the top of the file, after the imports:

```ts
const VOCAB_BAND_LABELS: Record<string, string> = {
  top_1k: 'Top 1k',
  top_3k: 'Top 3k',
  top_6k: 'Top 6k',
  top_10k: 'Top 10k',
  top_50k: 'Top 50k',
  rare_or_unknown: 'Raro',
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/ales/workspace/personal/miguelito-ts/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/ales/workspace/personal/miguelito-ts && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/ales/workspace/personal/miguelito-ts && git add web/src/molecules/SettingsDrawer.tsx && git commit -m "feat(web): show vocab band in Progreso section, remove morph/fluency cards"
```
