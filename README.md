# Miguelito

An AI language tutor that lives in your Telegram or browser. It has memory — it tracks vocabulary, your interests, your goals — and sends you practice prompts morning and evening.

Currently supports Spanish.

## How it works

- You chat with Miguelito in Telegram (or the web UI)
- It teaches in context: picks up on errors, logs vocabulary, adjusts to your level
- After each turn it quietly evaluates your response and updates your profile
- Morning and evening it sends a personalized practice message
- Each night it consolidates its memory about you ("dreaming")

## Quick start

```bash
cp .env.example .env
# Fill in OPENROUTER_API_KEY and TELEGRAM_BOT_TOKEN
npm install
npm run dev
```

## Transports

| Mode | What it is | Set `TRANSPORT=` |
|------|-----------|-----------------|
| `telegram` | Telegram bot | `telegram` |
| `web` | Browser chat UI | `web` |
| `tui` | Terminal UI | `tui` |

## Web UI

```bash
npm run web        # starts the React dev server
```

The web UI runs entirely in the browser using WebLLM (local model) or OpenRouter. No server needed.

## Models

Configured via `.env`:
- `CHAT_MODEL` — fast model for live turns (default: Gemini Flash)
- `EVALUATOR_MODEL` — smarter async model for evaluation and dreams (default: DeepSeek)

You can swap in any model available on OpenRouter, or point at a local Ollama instance with `PROVIDER=ollama`.

## Schedule

Morning and evening practice messages are sent on cron (default 9:00 / 19:30, configurable via `MORNING_CRON` / `EVENING_CRON` and `TIMEZONE`).
