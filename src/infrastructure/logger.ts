import pino from 'pino';
import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';
fs.mkdirSync(LOG_DIR, { recursive: true });

const prettyTransport = pino.transport({
  target: 'pino-pretty',
  options: {
    destination: path.join(LOG_DIR, 'app.pretty.log'),
    append: true,
    colorize: false,
  },
});

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream([
    { stream: fs.createWriteStream(path.join(LOG_DIR, 'app.json.log'), { flags: 'a' }) },
    { stream: prettyTransport },
  ]),
);
