# Miguelito

Miguelito is a Telegram-first Spanish tutor: conversation → useful material extraction/import → contextual repetition → observed passive/active progress.

## What works now

- Spanish Telegram bot in one Node process.

- `/import` for pasted phrases and Anki TSV exports (`front<TAB>back`).
- `/drill` for short opt-in practice from imported or conversation-native items.
- `/scenario` for short roleplay scenarios.
- Nightly memory/dream and learning hygiene jobs.

## Quick start

```bash
cp .env.example .env
# Fill OPENROUTER_API_KEY, TELEGRAM_BOT_TOKEN/TELEGRAM_SPANISH_BOT_TOKEN, TELEGRAM_CHAT_ID
npm install
npm run build
npm start
```

## Commands

- `/start` — Spanish-only onboarding.
- `/import` — paste one item per line: `ola de calor = heat wave`, Anki TSV: `ola de calor<TAB>heat wave`, or a direct `https://...` TSV/APKG link.
- `/drill` — start/continue a short practice session.
- `/scenario` — choose a short roleplay.

## Reports

```bash
npm run report:costs -- 7
npm run report:learning
```


