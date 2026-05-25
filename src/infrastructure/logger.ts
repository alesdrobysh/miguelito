import pino from 'pino';
import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';
fs.mkdirSync(LOG_DIR, { recursive: true });

export function logPathsForEnv(env: Record<string, string | undefined> = process.env): { json: string; pretty: string } {
  const logPrefix = env.ENV === 'test' || env.NODE_ENV === 'test' || env.VITEST ? 'test' : 'app';
  return {
    json: path.join(LOG_DIR, `${logPrefix}.json.log`),
    pretty: path.join(LOG_DIR, `${logPrefix}.pretty.log`),
  };
}

export const logPaths = logPathsForEnv();

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
