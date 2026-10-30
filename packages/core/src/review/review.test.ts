import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { completeSession, skipSession } from '../sessions/lifecycle';
import {
  grid,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
} from '../sessions/fixtures.test-helpers';
import { getReviewCounts, getReviewOverview, markReviewSeen } from './review';

let prisma: PrismaClient;
let drop: () => Promise<void>;

const at = (ms: number) => new Date(NOW.getTime() + ms);
const HOUR = 3_600_000;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('review overview (S2-4)', () => {
  it('a completion appears in newCompleted on the next read; another org never appears (Review Focus #5)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(2, 3) });
    const other = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(2, 3) });
    const [mine] = await sessionsOf(prisma, w.assignmentId);
    const [theirs] = await sessionsOf(prisma, other.assignmentId);
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, mine!.id, { idempotencyKey: randomUUID() }, { now: at(-HOUR) }),
    );
    await runAs(prisma, other.client, (tx) =>
      completeSession(
        tx,
        other.client,
        theirs!.id,
        { idempotencyKey: randomUUID() },
        { now: at(-HOUR) },
      ),
    );
    const view = await runAs(prisma, w.coach, (tx) => getReviewOverview(tx, w.coach, { now: NOW }));
    expect(view.newCompleted.count).toBe(1);
    expect(view.newCompleted.items).toEqual([
      expect.objectContaining({
        sessionId: mine!.id,
        clientId: w.clientId,
        clientName: 'Client',
        title: 'W1D1',
        state: 'completed',
        loggedByCoach: false,
      }),
    ]);
    expect(view.seenAt).toBeNull();
  });

  it('mark seen hides older completions; a later completion shows again', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(2, 3) });
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    await runAs(prisma, w.client, (tx) =>
      completeSession(
        tx,
        w.client,
        a!.id,
        { idempotencyKey: randomUUID() },
        { now: at(-2 * HOUR) },
      ),
    );
    const seen = await runAs(prisma, w.coach, (tx) =>
      markReviewSeen(tx, w.coach, { through: at(-HOUR).toISOString() }, { now: NOW }),
    );
    expect(seen.seenAt).toBe(at(-HOUR - 5_000).toISOString());
    let view = await runAs(prisma, w.coach, (tx) => getReviewOverview(tx, w.coach, { now: NOW }));
    expect(view.newCompleted.count).toBe(0);
    expect(view.seenAt).toBe(at(-HOUR - 5_000).toISOString());
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, b!.id, { idempotencyKey: randomUUID() }, { now: NOW }),
    );
    view = await runAs(prisma, w.coach, (tx) => getReviewOverview(tx, w.coach, { now: NOW }));
    expect(view.newCompleted.items.map((i) => i.sessionId)).toEqual([b!.id]);
  });

  it("due this week and skipped this week use the organization's week", async () => {
    // Org and client in New York; Mon/Wed/Fri from Wed 11-04 for 2 weeks. This week: 11-04 and 11-06.
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(2, 3) });
    const [d1, d2] = await sessionsOf(prisma, w.assignmentId);
    let view = await runAs(prisma, w.coach, (tx) => getReviewOverview(tx, w.coach, { now: NOW }));
    expect(view.week).toEqual({ startLocalDate: '2026-11-02', endLocalDate: '2026-11-08' });
    expect(view.dueThisWeek.items.map((i) => i.scheduledLocalDate)).toEqual([
      '2026-11-04',
      '2026-11-06',
    ]);
    await runAs(prisma, w.client, (tx) =>
      skipSession(tx, w.client, d2!.id, { idempotencyKey: randomUUID() }, { now: NOW }),
    );
    view = await runAs(prisma, w.coach, (tx) => getReviewOverview(tx, w.coach, { now: NOW }));
    expect(view.dueThisWeek.items.map((i) => i.sessionId)).toEqual([d1!.id]);
    expect(view.skippedThisWeek).toMatchObject({ count: 1, items: [{ sessionId: d2!.id }] });
    // Sunday 22:00 in New York is Monday in UTC: still the org's week.
    view = await runAs(prisma, w.coach, (tx) =>
      getReviewOverview(tx, w.coach, { now: new Date('2026-11-09T03:00:00Z') }),
    );
    expect(view.week.startLocalDate).toBe('2026-11-02');
  });

  it('client role → FORBIDDEN', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const codes = await Promise.all([
      runAs(prisma, w.client, (tx) => getReviewOverview(tx, w.client)).catch((e: unknown) => e),
      runAs(prisma, w.client, (tx) =>
        markReviewSeen(tx, w.client, { through: NOW.toISOString() }),
      ).catch((e: unknown) => e),
      runAs(prisma, w.client, (tx) => getReviewCounts(tx, w.client)).catch((e: unknown) => e),
    ]);
    expect(codes.map((e) => (e as DomainError).code)).toEqual([
      'FORBIDDEN',
      'FORBIDDEN',
      'FORBIDDEN',
    ]);
  });

  it('marking seen covers only what the coach was shown: a completion after the read stays new', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(2, 3) });
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, a!.id, { idempotencyKey: randomUUID() }, { now: at(-HOUR) }),
    );
    const shown = await runAs(prisma, w.coach, (tx) =>
      getReviewOverview(tx, w.coach, { now: NOW }),
    );
    // A completion lands between the read and the click.
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, b!.id, { idempotencyKey: randomUUID() }, { now: at(HOUR) }),
    );
    await runAs(prisma, w.coach, (tx) =>
      markReviewSeen(tx, w.coach, { through: shown.generatedAt }, { now: at(2 * HOUR) }),
    );
    const later = await runAs(prisma, w.coach, (tx) =>
      getReviewOverview(tx, w.coach, { now: at(2 * HOUR) }),
    );
    expect(later.newCompleted.items.map((i) => i.sessionId)).toEqual([b!.id]);
    // Never backwards; a future `through` is capped at now.
    await runAs(prisma, w.coach, (tx) =>
      markReviewSeen(tx, w.coach, { through: at(-10 * HOUR).toISOString() }, { now: at(2 * HOUR) }),
    );
    expect(
      (await runAs(prisma, w.coach, (tx) => getReviewOverview(tx, w.coach, { now: at(2 * HOUR) })))
        .seenAt,
    ).toBe(at(-5_000).toISOString());
    const counts = await runAs(prisma, w.coach, (tx) =>
      getReviewCounts(tx, w.coach, { now: at(2 * HOUR) }),
    );
    expect(counts.newCompleted).toBe(1);
  });
});
