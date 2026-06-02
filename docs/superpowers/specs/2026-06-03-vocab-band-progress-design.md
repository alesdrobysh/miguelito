# Vocab Band in Progress Section — Design Spec

**Date:** 2026-06-03

## Overview

Show the vocabulary band the user tends to use in the "Progreso" section of the Perfil tab in SettingsDrawer. Replaces the existing Morfología and Fluidez cards with a single "Vocabulario" card showing the weighted-mode challenge band from recent production evidence.

## Data Layer

### Repository interface change

`src/repositories/interfaces.ts` — add to `CompetencyRepository`:

```ts
getTypicalVocabBand(limit: number): Promise<ProficiencyChallengeBand | null>
```

Returns the `challenge_band` value with the highest sum of `weight` among the last `limit` rows in `proficiency_evidence` where `skill = 'production'` and `language` matches. Returns `null` if no production evidence exists.

### SQL query

```sql
SELECT challenge_band
FROM (
  SELECT challenge_band, weight
  FROM proficiency_evidence
  WHERE language = ? AND skill = 'production'
  ORDER BY id DESC LIMIT ?
)
GROUP BY challenge_band
ORDER BY SUM(weight) DESC
LIMIT 1
```

### Implementation

`src/infrastructure/repositories/competencyRepository.ts` — add `getTypicalVocabBand` using the SQL above.

`BuddyDb` already delegates to `competencyRepository`, so no additional wiring is needed for either Node or browser.

## PerfilData

`web/src/context/AppContext.tsx`:

- Add `vocabBand: ProficiencyChallengeBand | null` to the `PerfilData` interface.
- In `loadPerfilData`, call `rt.db.getTypicalVocabBand(50)` alongside existing queries and include result in the returned object.

## UI

`web/src/molecules/SettingsDrawer.tsx` — in the "Progreso" section (currently renders a 2-col grid of Morfología + Fluidez cards):

- Remove both existing cards.
- Render a single card with label `Vocabulario` and the formatted band value.
- Band label mapping:
  - `top_1k` → `Top 1k`
  - `top_3k` → `Top 3k`
  - `top_6k` → `Top 6k`
  - `top_10k` → `Top 10k`
  - `top_50k` → `Top 50k`
  - `rare_or_unknown` → `Raro`
  - `null` → `—`
- The card uses the same styling as the removed ones (border, small uppercase label, large value).
- The "Progreso" section only renders when `perfilData?.vocabBand !== undefined` (i.e., the field is present — show even if null, since null means "no data yet" and should display `—`).

## Out of scope

- No changes to how evidence is written (PostTurnProcessor unchanged).
- No changes to Morfología/Fluidez data — they are simply removed from the UI; the underlying data stays in the DB.
- No new migrations needed.
