import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  createJoinLink,
  joinWithLink,
  listJoinLinks,
  lookupJoinLink,
  revokeJoinLink,
} from './joinLinks';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('join links (PRD B3)', () => {
  it('signs people up as invited clients with an invite email, up to the cap, until revoked', async () => {
    const org = await newOrg(prisma);
    const link = await runAs(prisma, org.coach, (tx) =>
      createJoinLink(tx, org.coach, { maxUses: 2 }),
    );
    expect(await lookupJoinLink(link.token, prisma)).toMatchObject({ usable: true });
    const join = (email: string) =>
      joinWithLink({ token: link.token, name: 'Walk In', email }, { prisma });
    expect(await join('one@example.test')).toBe('sent');
    // Already a client: same answer, nothing sent or counted.
    expect(await join('ONE@example.test')).toBe('sent');
    expect(await join('two@example.test')).toBe('sent');
    expect(await join('three@example.test')).toBe('closed');

    const state = await withSystem(
      async (tx) => ({
        clients: await tx.client.findMany({
          where: { organizationId: org.orgId },
          select: { email: true, status: true, coachUserId: true },
          orderBy: { email: 'asc' },
        }),
        emails: await tx.outboxEmail.count({
          where: { organizationId: org.orgId, kind: 'client_invite' },
        }),
      }),
      prisma,
    );
    expect(state.clients).toEqual([
      { email: 'one@example.test', status: 'invited', coachUserId: org.coach.userId },
      { email: 'two@example.test', status: 'invited', coachUserId: org.coach.userId },
    ]);
    expect(state.emails).toBe(2);
    const [listed] = await runAs(prisma, org.coach, (tx) => listJoinLinks(tx, org.coach));
    expect(listed).toMatchObject({ uses: 2, maxUses: 2, active: false });

    const open = await runAs(prisma, org.coach, (tx) =>
      createJoinLink(tx, org.coach, { maxUses: 10 }),
    );
    await runAs(prisma, org.coach, (tx) => revokeJoinLink(tx, org.coach, open.id));
    expect(
      await joinWithLink(
        { token: open.token, name: 'Late', email: 'late@example.test' },
        { prisma },
      ),
    ).toBe('closed');
    expect(await lookupJoinLink(open.token, prisma)).toMatchObject({ usable: false });
    expect(await lookupJoinLink('not-a-real-token-at-all-xxxxx', prisma)).toBeNull();
    await expect(
      joinWithLink({ token: open.token, name: 'X', email: 'nope' }, { prisma }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      runAs(prisma, org.coach, (tx) => createJoinLink(tx, org.coach, { maxUses: 500 })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
