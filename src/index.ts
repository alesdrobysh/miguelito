import { loadConfig } from "./config.js";
import { BuddyDb } from "./db.js";
import { createBot } from "./bot.js";
import { startScheduler } from "./scheduler.js";

async function main() {
  const config = loadConfig();
  const db = await BuddyDb.open(config.dbPath);
  const bot = createBot(config, db);

  startScheduler(config, db, bot);

  console.log("miguelito-ts starting...");
  console.log(`Model: ${config.openrouterModel}`);
  console.log(`DB: ${config.dbPath}`);

  bot.start({
    onStart: (info) => console.log(`Bot @${info.username} started`),
    allowed_updates: ["message"],
  });
}

main();
