import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { postNotice, readNotices, resolveNotice } from './notices';
import { requestSupport } from './support';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let adminId: string;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  adminId = (
    await withSystem(
      (tx) =>
        tx.user.create({
          data: { email: 'ops@example.test', name: 'Ops', isPlatformAdmin: true },
        }),
      prisma,
    )
  ).id;
});
afterAll(async () => {
  await drop();
});

describe('status notices (PRD M8)', () => {
  it('an admin posts and resolves a notice; everyone reads it; others cannot post', async () => {
    const admin = { userId: adminId, isPlatformAdmin: true };
    const posted = await withSystem(
      (tx) => postNotice(tx, admin, { severity: 'degraded', message: 'Sync is slow' }),
      prisma,
    );
    expect((await readNotices(prisma)).open.map((n) => n.message)).toEqual(['Sync is slow']);
    await withSystem(
      (tx) => resolveNotice(tx, admin, posted.id, { postmortem: 'A slow query; fixed.' }),
      prisma,
    );
    const after = await readNotices(prisma);
    expect(after.open).toEqual([]);
    expect(after.recent[0]).toMatchObject({ postmortem: 'A slow query; fixed.' });
    await expect(
      withSystem(
        (tx) =>
          postNotice(
            tx,
            { userId: adminId, isPlatformAdmin: false },
            { severity: 'outage', message: 'x' },
          ),
        prisma,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      withSystem((tx) => postNotice(tx, admin, { severity: 'panic', message: 'x' }), prisma),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('support requests (PRD M13)', () => {
  it('emails the support inbox with the message, and audits only the topic', async () => {
    const org = await newOrg(prisma);
    await runAs(prisma, org.coach, (tx) =>
      requestSupport(
        tx,
        org.coach,
        { topic: 'problem', message: 'The calendar shows nothing.' },
        {
          to: 'help@example.test',
        },
      ),
    );
    const mail = await withSystem(
      (tx) =>
        tx.outboxEmail.findFirst({ where: { kind: 'support_request', organizationId: org.orgId } }),
      prisma,
    );
    expect(mail).toMatchObject({
      toEmail: 'help@example.test',
      payloadJson: expect.objectContaining({
        topic: 'problem',
        message: 'The calendar shows nothing.',
      }),
    });
    const audit = await withSystem(
      (tx) =>
        tx.auditEvent.findFirst({
          where: { action: 'support.requested', organizationId: org.orgId },
        }),
      prisma,
    );
    expect(JSON.stringify(audit?.metadataJson)).not.toContain('calendar');
    await expect(
      runAs(prisma, org.coach, (tx) =>
        requestSupport(
          tx,
          org.coach,
          { topic: 'problem', message: 'x' },
          { to: 'help@example.test' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
