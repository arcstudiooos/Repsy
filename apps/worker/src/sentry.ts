import * as Sentry from '@sentry/node';

/** Initialises Sentry only when SENTRY_DSN is set; otherwise a no-op. */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({ dsn: env.SENTRY_DSN });
  return true;
}

export { Sentry };
