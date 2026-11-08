import type { PrismaClient } from '@repsy/db';
import { DomainError } from '../errors';

export const ATTEMPT_LIMIT = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60_000;

/**
 * Per-key attempt limiter in Postgres (non-tenant `rate_limits` table, keys
 * namespaced `repsy:` so they never collide with Better Auth's own rows).
 * `last_request` holds the window start; the increment is an atomic upsert.
 */
async function consume(prisma: PrismaClient, key: string, now: Date): Promise<number> {
  const nowMs = BigInt(now.getTime());
  const fullKey = `repsy:${key}`;
  // Start a fresh window when the previous one has lapsed.
  await prisma.rateLimit.updateMany({
    where: { key: fullKey, lastRequest: { lte: nowMs - BigInt(ATTEMPT_WINDOW_MS) } },
    data: { count: 0, lastRequest: nowMs },
  });
  const row = await prisma.rateLimit.upsert({
    where: { key: fullKey },
    create: { key: fullKey, count: 1, lastRequest: nowMs },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

/**
 * Counts one attempt against every key (e.g. `ip:…`, `email:…`) and throws
 * DomainError('RATE_LIMITED') when any key is past 5 attempts per 15 minutes.
 */
export async function enforceAttemptLimit(
  prisma: PrismaClient,
  keys: string[],
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  let limited = false;
  for (const key of keys) {
    if ((await consume(prisma, key, now)) > ATTEMPT_LIMIT) limited = true;
  }
  if (limited) throw new DomainError('RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.');
}
