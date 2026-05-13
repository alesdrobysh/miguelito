import { describe, it, expect } from 'vitest';
import { logger } from './logger.js';

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
});
