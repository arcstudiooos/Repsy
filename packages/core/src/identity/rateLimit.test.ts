import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { enforceAttemptLimit } from './rateLimit';

let prisma: PrismaClient;
let drop: () => Promise<void>;
const MIN = 60_000;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('enforceAttemptLimit', () => {
  it('allows 5 attempts in 15 minutes; the 6th is RATE_LIMITED', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 5; i += 1) {
      await enforceAttemptLimit(prisma, ['ip:1.1.1.1'], { now: new Date(t0.getTime() + i * MIN) });
    }
    const error = await enforceAttemptLimit(prisma, ['ip:1.1.1.1'], {
      now: new Date(t0.getTime() + 6 * MIN),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('RATE_LIMITED');
  });

  it('window resets after 15 minutes and keys are independent', async () => {
    const t0 = new Date('2026-01-02T00:00:00Z');
    for (let i = 0; i < 5; i += 1) await enforceAttemptLimit(prisma, ['ip:2.2.2.2'], { now: t0 });
    await expect(enforceAttemptLimit(prisma, ['ip:2.2.2.2'], { now: t0 })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(enforceAttemptLimit(prisma, ['ip:3.3.3.3'], { now: t0 })).resolves.toBeUndefined();
    const later = new Date(t0.getTime() + 15 * MIN + 1);
    await expect(
      enforceAttemptLimit(prisma, ['ip:2.2.2.2'], { now: later }),
    ).resolves.toBeUndefined();
  });

  it('any exhausted key blocks the attempt', async () => {
    const now = new Date('2026-01-03T00:00:00Z');
    for (let i = 0; i < 5; i += 1) await enforceAttemptLimit(prisma, ['email:a@x.test'], { now });
    await expect(
      enforceAttemptLimit(prisma, ['ip:9.9.9.9', 'email:a@x.test'], { now }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
