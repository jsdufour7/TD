import { env, redactSecrets } from './env';

/**
 * Structured logging. Every message is passed through redactSecrets so a
 * credential can never reach stdout, a log file or an error response (§41).
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold: number = LEVEL_ORDER[(process.env.LOG_LEVEL as Level) ?? (env.isProduction ? 'info' : 'debug')] ?? 20;

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: redactSecrets(message),
  };
  if (meta) {
    // Metadata is stringified first so nested values are also redacted.
    line.meta = JSON.parse(redactSecrets(JSON.stringify(meta)));
  }
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => emit('debug', scope, message, meta),
    info: (message: string, meta?: Record<string, unknown>) => emit('info', scope, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => emit('warn', scope, message, meta),
    error: (message: string, meta?: Record<string, unknown>) => emit('error', scope, message, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
