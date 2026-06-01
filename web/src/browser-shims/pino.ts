// Browser shim for pino — routes to console

type Logger = {
  info: (...a: unknown[]) => void
  warn: (...a: unknown[]) => void
  error: (...a: unknown[]) => void
  debug: (...a: unknown[]) => void
  child: (_bindings: Record<string, unknown>) => Logger
  fatal: (...a: unknown[]) => void
}

function makeLogger(prefix = ''): Logger {
  const tag = prefix ? `[${prefix}]` : ''
  return {
    info:  (...a) => console.info(tag, ...a),
    warn:  (...a) => console.warn(tag, ...a),
    error: (...a) => console.error(tag, ...a),
    debug: () => {},
    fatal: (...a) => console.error(tag, ...a),
    child: (b) => makeLogger(b['ctx'] as string ?? prefix),
  }
}

const pino = Object.assign(
  (_opts?: unknown, _stream?: unknown) => makeLogger(),
  {
    transport: () => null,
    multistream: () => null,
  },
)

export default pino
