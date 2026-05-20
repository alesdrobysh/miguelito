import fs from "fs";
import path from "path";
import { loadConfig } from "./infrastructure/config.js";
import { loadLanguage } from "./languages/index.js";
import { BuddyDb } from "./infrastructure/db.js";
import { logger } from "./infrastructure/logger.js";
import { OpenRouterProvider } from "./providers/OpenRouterProvider.js";
import { OllamaProvider } from "./providers/OllamaProvider.js";
import { PromptBuilder } from "./agent/PromptBuilder.js";
import { AgentRunner } from "./agent/AgentRunner.js";
import { TelegramTransport } from "./transport/TelegramTransport.js";
import { TuiTransport } from "./transport/TuiTransport.js";
import { DreamService } from "./services/DreamService.js";
import { startScheduler } from "./services/Scheduler.js";
import { statusOf } from "./domain/fsrs.js";
import { getCompetencyVector, selectFocusAxis } from "./domain/competency.js";
import type { ChatMessage } from "./llm.js";

const log = logger.child({ ctx: 'app' });

process.on("uncaughtException", (e) => {
  log.error({ err: e }, 'uncaughtException');
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  log.error({ err: e }, 'unhandledRejection');
  process.exit(1);
});

async function main() {
  const config = loadConfig();
  const lang = loadLanguage(process.env.LANGUAGE ?? "spanish");

  if (!process.env.DB_PATH) {
    config.dbPath = `./data/buddy-${lang.id}.db`;
  }
  if (!process.env.DREAM_MEMORY_PATH) {
    config.dreamMemoryPath = `./data/memory/MEMORY-${lang.id}.md`;
  }

  const morningCronPrompt = process.env.MORNING_CRON_PROMPT ?? lang.prompts.morning;
  const eveningCronPrompt = process.env.EVENING_CRON_PROMPT ?? lang.prompts.evening;

  const db = await BuddyDb.open(config.dbPath, lang.id, lang.errorCategories, lang.morphologyCategories);
  const sharedDbPath = path.join(path.dirname(config.dbPath), "buddy-shared.db");
  const sharedDb = await BuddyDb.open(sharedDbPath, "shared", [], []);

  const provider = config.provider === "ollama"
    ? new OllamaProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        apiKey: config.ollamaApiKey || undefined,
      })
    : new OpenRouterProvider({
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel,
        baseUrl: config.openrouterBaseUrl,
      });

  const toolCtx = { vocab: db, errors: db, profile: sharedDb, langProfile: db, interests: sharedDb, competency: db, session: db, provider };
  const promptBuilder = new PromptBuilder(
    { vocab: db, errors: db, profile: sharedDb, langProfile: db, interests: sharedDb, competency: db, session: db },
    lang,
  );

  const agentRunner = new AgentRunner({
    provider,
    session: db,
    promptBuilder,
    toolCtx,
    lang,
    dreamMemoryPath: config.dreamMemoryPath,
  });

  const dreamService = new DreamService(db, db, db, provider, {
    timezone: config.timezone,
    dreamMemoryPath: config.dreamMemoryPath,
    dreamSystemPrompt: lang.prompts.dream,
    morphologyCategories: new Set(lang.morphologyCategories),
  });

  const transport = config.transport === "tui"
    ? new TuiTransport()
    : new TelegramTransport({
        telegramToken: config.telegramToken,
        allowedUsers: config.allowedUsers,
      });

  transport.onMessage(async (chatId, userId, text) => {
    if (text === "/dream") return dreamService.run();
    if (text === "/memory") {
      try {
        if (fs.existsSync(config.dreamMemoryPath)) {
          return fs.readFileSync(config.dreamMemoryPath, "utf-8");
        }
        return lang.id === "polish"
          ? "Brak pliku pamięci."
          : "No se encontró el archivo de memoria.";
      } catch (err) {
        log.error({ err }, "Error reading memory file");
        return lang.id === "polish"
          ? "Nie udało się odczytać pamięci."
          : "No se pudo leer el archivo de memoria.";
      }
    }
    if (text === "/vocabulary") {
      const items = await db.listVocab("all", 50);
      if (items.length === 0) return "Tu vocabulario está vacío.";
      const lines = items.map((r) => {
        const status = statusOf(r.pro_reps, r.pro_stability);
        const icon = status === "mastered" ? "✅" : status === "review" ? "⏳" : status === "learning" ? "🌱" : "🆕";
        return `${icon} **${r.chunk_l2}**${r.anchor ? ` (${r.anchor})` : ""}`;
      });
      return `📚 **Tu Vocabulario (últimos 50)**\n\n${lines.join("\n")}`;
    }
    if (text === "/proficiency") {
      try {
        const cv = await getCompetencyVector({ competency: db, vocab: db });
        const focus = selectFocusAxis(cv, lang);

        if (lang.id === "polish") {
          const focusDesc = focus
            ? {
                morphology: "Morfologia (odmiana i końcówki)",
                idiomaticity: "Idiomatyka (naturalne zwroty i wyrażenia)",
                lexicon: "Słownictwo (rozszerzanie aktywnego leksykonu)",
                syntax: "Syntaktyka (budowa zdań złożonych)",
              }[focus]
            : "Płynna konwersacja (zbalansowany poziom)";

          const conf = (c: string) => (c === "low" ? " (tworzy się)" : "");

          return `📊 **Twój Poziom Biegłości** 🇵🇱

📚 **Słownictwo (Leksyka):**
• Aktywne frazy: **${cv.lexicon.activeChunks}**${conf(cv.lexicon.confidence)}
• Rzadkość słownictwa: **${cv.lexicon.lexicalRarity.toFixed(2)}**

✍️ **Składnia (Budowa zdań):**
• Średnia długość (T-units): **${cv.syntax.meanTunitLength.toFixed(1)}** wyrazów${conf(cv.syntax.confidence)}
• Wskaźnik zdań podrzędnych: **${Math.round(cv.syntax.subIndex * 100)}%**

🧬 **Morfologia (Poprawność form):**
• Dokładność: **${Math.round(cv.morphology.rate * 100)}%**${conf(cv.morphology.confidence)} (próby: ${cv.morphology.obs})

🗣️ **Idiomatyka (Naturalność):**
• Naturalność wyrażeń: **${Math.round(cv.idiomaticity.rate * 100)}%**${conf(cv.idiomaticity.confidence)} (próby: ${cv.idiomaticity.obs})

👂 **Rozumienie (Recepcja):**
• Płynność rozumienia: **${Math.round(cv.reception.level * 100)}%**${conf(cv.reception.confidence)}

🔍 **Samokontrola:**
• Zauważone poprawki własne: **${cv.monitoring.selfCorrectionObs}**

🎯 **Aktualny cel dydaktyczny:**
• **${focusDesc}**`;
        } else {
          // Spanish or fallback
          const focusDesc = focus
            ? {
                morphology: "Morfología (conjugación y concordancia)",
                idiomaticity: "Idiomaticidad (expresiones naturales y colocaciones)",
                lexicon: "Vocabulario (ampliación de léxico activo)",
                syntax: "Sintaxis (estructuras y oraciones subordinadas)",
              }[focus]
            : "Conversación fluida (nivel equilibrado)";

          const conf = (c: string) => (c === "low" ? " (en formación)" : "");

          return `📊 **Tu Nivel de Competencia** 🇪🇸

📚 **Vocabulario (Léxico):**
• Expresiones activas: **${cv.lexicon.activeChunks}**${conf(cv.lexicon.confidence)}
• Rareza léxica: **${cv.lexicon.lexicalRarity.toFixed(2)}**

✍️ **Sintaxis (Estructura de oraciones):**
• Longitud media (T-units): **${cv.syntax.meanTunitLength.toFixed(1)}** palabras${conf(cv.syntax.confidence)}
• Índice de subordinación: **${Math.round(cv.syntax.subIndex * 100)}%**

🧬 **Morfología (Precisión gramatical):**
• Precisión: **${Math.round(cv.morphology.rate * 100)}%**${conf(cv.morphology.confidence)} (obs: ${cv.morphology.obs})

🗣️ **Idiomaticidad (Naturalidad):**
• Naturalidad: **${Math.round(cv.idiomaticity.rate * 100)}%**${conf(cv.idiomaticity.confidence)} (obs: ${cv.idiomaticity.obs})

👂 **Comprensión (Recepción):**
• Fluidez de comprensión: **${Math.round(cv.reception.level * 100)}%**${conf(cv.reception.confidence)}

🔍 **Autocorrección:**
• Correcciones detectadas: **${cv.monitoring.selfCorrectionObs}**

🎯 **Foco pedagógico actual:**
• **${focusDesc}**`;
        }
      } catch (err) {
        log.error({ err }, "Error computing proficiency");
        return lang.id === "polish"
          ? "Nie udało się pobrać danych o biegłości."
          : "No se pudo obtener la información de competencia.";
      }
    }

    const { session: convState } = await db.getConversationState();
    const history = await db.getSessionTranscript(convState.session_id) as ChatMessage[];
    await db.addChatMessage(chatId, "user", text, convState.session_id);

    const result = await agentRunner.run(text, history);
    if (result.text) {
      await db.addChatMessage(chatId, "assistant", result.text, convState.session_id);
    }
    return result.text || null;
  });

  const model = config.provider === "ollama" ? config.ollamaModel : config.openrouterModel;
  log.info({ provider: config.provider, model, dbPath: config.dbPath, transport: config.transport, language: lang.id }, 'miguelito-ts starting');

  if (config.transport === "telegram") {
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
      (prompt) => agentRunner.run(prompt, []),
      dreamService,
      transport,
    );
    transport.start({
      onStart: (info: { username: string }) => log.info({ username: info.username }, 'bot started'),
      allowed_updates: ["message"],
    });
  } else {
    transport.start();
  }
}

main().catch((e) => {
  log.error({ err: e }, 'Fatal error in main');
  process.exit(1);
});
