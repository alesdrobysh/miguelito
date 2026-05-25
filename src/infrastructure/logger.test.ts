import { describe, it, expect } from 'vitest';
import { logger, logPaths, logPathsForEnv } from './logger.js';

describe('logger', () => {
  it('exports a pino logger with standard methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('creates a child logger', () => {
    const child = logger.child({ ctx: 'test' });
    expect(typeof child.info).toBe('function');
  });

  it('keeps test runs out of production runtime log files', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(logPaths.json).toContain('test.json.log');
    expect(logPaths.pretty).toContain('test.pretty.log');
    expect(logPaths.json).not.toContain('app.json.log');
  });

  it('treats ENV=test as an isolated runtime log prefix', () => {
    const paths = logPathsForEnv({ ENV: 'test', NODE_ENV: 'production', VITEST: undefined });

    expect(paths.json).toContain('test.json.log');
    expect(paths.pretty).toContain('test.pretty.log');
    expect(paths.json).not.toContain('app.json.log');
  });
});
