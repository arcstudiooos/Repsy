export const DEFAULT_OUTBOX_POLL_INTERVAL_MS = 30_000;

/** OUTBOX_POLL_INTERVAL_MS, falling back to 30s when unset or not a positive integer. */
export function outboxPollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OUTBOX_POLL_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_OUTBOX_POLL_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('OUTBOX_POLL_INTERVAL_MS must be a positive integer');
  }
  return value;
}
