import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from './generated/client';
import { appendAudit } from './audit';
import { createTestDb } from './testing/createTestDb';
import { withSystem, withTenant } from './tenant';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgId: string;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  orgId = await withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email: 'o@example.test', name: 'O' } });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: user.id },
    });
    return org.id;
  }, prisma);
});

afterAll(async () => {
  await drop();
});

describe('audit events', () => {
  it('appendAudit writes an event scoped to the org', async () => {
    const row = await withTenant(
      orgId,
      (tx) =>
        appendAudit(tx, {
          orgId,
          actorId: null,
          objectType: 'client',
          objectId: 'c1',
          action: 'client.created',
          metadata: { count: 1 },
          requestId: 'req-1',
        }),
      prisma,
    );
    expect(row).toMatchObject({
      organizationId: orgId,
      actorId: null,
      action: 'client.created',
      metadataJson: { count: 1 },
      requestId: 'req-1',
    });
  });

  it('audit events are append-only', async () => {
    const row = await withSystem(
      (tx) => tx.auditEvent.findFirstOrThrow({ where: { organizationId: orgId } }),
      prisma,
    );
    await expect(
      withSystem(
        (tx) => tx.auditEvent.update({ where: { id: row.id }, data: { action: 'tampered' } }),
        prisma,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withSystem((tx) => tx.auditEvent.delete({ where: { id: row.id } }), prisma),
    ).rejects.toThrow(/append-only/);
  });
});
