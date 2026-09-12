/**
 * Tiny dependency-free logger with levels + ANSI colours.
 * Swap the transport here (e.g. to pino/winston) without touching call sites.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

function enabled(level: Level): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel];
}

function stamp(): string {
  return new Date().toISOString();
}

function write(level: Level, scope: string, message: string, meta?: unknown): void {
  if (!enabled(level)) return;
  const tag = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const line = `${tag} ${stamp()} [${scope}] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) sink(line, meta);
  else sink(line);
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

/** Create a scoped logger, e.g. `createLogger('login-flow')`. */
export function createLogger(scope = 'app'): Logger {
  return {
    debug: (m, meta) => write('debug', scope, m, meta),
    info: (m, meta) => write('info', scope, m, meta),
    warn: (m, meta) => write('warn', scope, m, meta),
    error: (m, meta) => write('error', scope, m, meta),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

export const logger = createLogger('framework');
