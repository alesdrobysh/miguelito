import pino from 'pino';
import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';
fs.mkdirSync(LOG_DIR, { recursive: true });

const logPrefix = process.env.NODE_ENV === 'test' || process.env.VITEST ? 'test' : 'app';
export const logPaths = {
  json: path.join(LOG_DIR, `${logPrefix}.json.log`),
  pretty: path.join(LOG_DIR, `${logPrefix}.pretty.log`),
};

const prettyTransport = pino.transport({
  target: 'pino-pretty',
  options: {
    destination: logPaths.pretty,
    append: true,
    colorize: false,
  },
});

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream([
    { stream: fs.createWriteStream(logPaths.json, { flags: 'a' }) },
    { stream: prettyTransport },
  ]),
);
