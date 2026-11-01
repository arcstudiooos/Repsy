import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { listAuditLog } from './ownerLog';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('owner audit log (PRD A14)', () => {
  it('lists who did what to whom, newest first, without everyday activity or content', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // assigns a program: assignment.created
    await runAs(prisma, org.coach, async (tx) => {
      await appendAudit(tx, {
        orgId: org.orgId,
        actorId: org.coach.userId,
        objectType: 'message',
        objectId: w.clientId,
        action: 'message.sent',
      });
      await appendAudit(tx, {
        orgId: org.orgId,
        actorId: org.coach.userId,
        objectType: 'export',
        objectId: w.clientId,
        action: 'export.requested',
        metadata: { clientId: w.clientId },
      });
    });
    const log = await runAs(prisma, org.coach, (tx) => listAuditLog(tx, org.coach));
    const actions = log.items.map((i) => i.action);
    expect(actions).toContain('assignment.created');
    expect(actions[0]).toBe('export.requested');
    expect(actions).not.toContain('message.sent');
    expect(log.items[0]).toMatchObject({
      label: 'Requested an export',
      actorName: 'Coach',
      clientName: 'Client',
    });
    const data = await runAs(prisma, org.coach, (tx) =>
      listAuditLog(tx, org.coach, { category: 'data' }),
    );
    expect(data.items.map((i) => i.action)).toEqual(['export.requested']);
  });

  it('is for the owner only', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await expect(runAs(prisma, w.client, (tx) => listAuditLog(tx, w.client))).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    const coach = { ...org.coach, role: 'coach' as const };
    await expect(runAs(prisma, coach, (tx) => listAuditLog(tx, coach))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
