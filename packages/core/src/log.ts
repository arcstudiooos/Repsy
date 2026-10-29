import pino, { type DestinationStream, type Logger } from 'pino';

const SENSITIVE_KEYS = ['body', 'password', 'token'];

/** Redact at the top level and up to three levels of nesting. */
const REDACT_PATHS = SENSITIVE_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `*.*.*.${key}`,
]);

export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    },
    destination,
  );
}

export const logger: Logger = createLogger();
export type { Logger };
