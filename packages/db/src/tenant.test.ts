import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from './generated/client';
import { createTestDb } from './testing/createTestDb';
import { withSystem, withTenant } from './tenant';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgA: string;
let orgB: string;
let userA: string;
let userB: string;

async function seedOrg(name: string, email: string) {
  return withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email, name } });
    const org = await tx.organization.create({
      data: { name, timezone: 'UTC', ownerUserId: user.id },
    });
    await tx.membership.create({
      data: { userId: user.id, organizationId: org.id, role: 'owner' },
    });
    await tx.auditEvent.create({
      data: { organizationId: org.id, objectType: 'test', objectId: `obj-${name}`, action: 'seed' },
    });
    await tx.outboxEmail.create({
      data: {
        organizationId: org.id,
        kind: 'k',
        toUserId: user.id,
        templateKey: 't',
        payloadJson: {},
        idempotencyKey: `idem-${name}`,
      },
    });
    return { orgId: org.id, userId: user.id };
  }, prisma);
}

const sys = <T>(fn: Parameters<typeof withSystem<T>>[0]) => withSystem(fn, prisma);

const membershipsOfB = () => sys((tx) => tx.membership.count({ where: { organizationId: orgB } }));

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  ({ orgId: orgA, userId: userA } = await seedOrg('A', 'a@example.test'));
  ({ orgId: orgB, userId: userB } = await seedOrg('B', 'b@example.test'));
});

afterAll(async () => {
  await drop();
});

describe('withTenant reads', () => {
  it('only returns rows of that org', async () => {
    const rows = await withTenant(orgA, (tx) => tx.auditEvent.findMany(), prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(orgA);
  });

  it('cannot read another org row by unique id', async () => {
    const other = await sys((tx) =>
      tx.auditEvent.findFirstOrThrow({ where: { organizationId: orgB } }),
    );
    const found = await withTenant(
      orgA,
      (tx) => tx.auditEvent.findUnique({ where: { id: other.id } }),
      prisma,
    );
    expect(found).toBeNull();
  });

  it('leaves models without organizationId untouched', async () => {
    const users = await withTenant(orgA, (tx) => tx.user.findMany(), prisma);
    expect(users).toHaveLength(2);
  });

  it('counts only own rows', async () => {
    expect(await withTenant(orgB, (tx) => tx.auditEvent.count(), prisma)).toBe(1);
  });

  it('organization only sees its own org', async () => {
    const orgs = await withTenant(orgA, (tx) => tx.organization.findMany(), prisma);
    expect(orgs.map((o) => o.id)).toEqual([orgA]);
    const other = await withTenant(
      orgA,
      (tx) => tx.organization.findUnique({ where: { id: orgB } }),
      prisma,
    );
    expect(other).toBeNull();
  });

  it('include traversal from User does not leak other orgs', async () => {
    const users = await withTenant(
      orgA,
      (tx) => tx.user.findMany({ include: { memberships: true, outboxEmails: true } }),
      prisma,
    );
    const b = users.find((x) => x.id === userB);
    expect(b?.memberships).toEqual([]);
    expect(b?.outboxEmails).toEqual([]);
    expect(users.find((x) => x.id === userA)?.memberships).toHaveLength(1);
  });
});

describe('withTenant writes', () => {
  it('create sets organizationId, ignoring a supplied foreign one', async () => {
    const row = await withTenant(
      orgA,
      (tx) =>
        tx.auditEvent.create({
          data: { organizationId: orgB, objectType: 't', objectId: 'x', action: 'create' },
        }),
      prisma,
    );
    expect(row.organizationId).toBe(orgA);
  });

  it('createMany is stamped with the org', async () => {
    await withTenant(
      orgA,
      (tx) =>
        tx.auditEvent.createMany({
          data: [
            { organizationId: orgB, objectType: 't', objectId: 'm1', action: 'cm' },
            { organizationId: orgB, objectType: 't', objectId: 'm2', action: 'cm' },
          ],
        }),
      prisma,
    );
    const rows = await sys((tx) => tx.auditEvent.findMany({ where: { action: 'cm' } }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.organizationId === orgA)).toBe(true);
  });

  it('update/updateMany cannot touch another org row', async () => {
    const other = await sys((tx) =>
      tx.outboxEmail.findFirstOrThrow({ where: { organizationId: orgB } }),
    );
    await expect(
      withTenant(
        orgA,
        (tx) => tx.outboxEmail.update({ where: { id: other.id }, data: { kind: 'hacked' } }),
        prisma,
      ),
    ).rejects.toThrow();
    const res = await withTenant(
      orgA,
      (tx) => tx.outboxEmail.updateMany({ data: { kind: 'hacked' } }),
      prisma,
    );
    expect(res.count).toBe(1);
    const still = await sys((tx) => tx.outboxEmail.findUniqueOrThrow({ where: { id: other.id } }));
    expect(still.kind).toBe('k');
  });

  it('data.organizationId is ignored on update and updateMany', async () => {
    await withTenant(
      orgA,
      (tx) => tx.outboxEmail.updateMany({ data: { organizationId: orgB, kind: 'moved' } }),
      prisma,
    );
    const moved = await sys((tx) => tx.outboxEmail.findMany({ where: { kind: 'moved' } }));
    expect(moved).toHaveLength(1);
    expect(moved[0]?.organizationId).toBe(orgA);

    const m = await sys((tx) =>
      tx.membership.findFirstOrThrow({ where: { organizationId: orgA } }),
    );
    await withTenant(
      orgA,
      (tx) => tx.membership.update({ where: { id: m.id }, data: { organizationId: orgB } }),
      prisma,
    );
    expect(await membershipsOfB()).toBe(1);
  });

  it('rejects organization relation in update data', async () => {
    const m = await sys((tx) =>
      tx.membership.findFirstOrThrow({ where: { organizationId: orgA } }),
    );
    await expect(
      withTenant(
        orgA,
        (tx) =>
          tx.membership.update({
            where: { id: m.id },
            data: { organization: { connect: { id: orgB } } },
          }),
        prisma,
      ),
    ).rejects.toThrow(/organization relation/);
  });

  it('delete/deleteMany only affect own org', async () => {
    const other = await sys((tx) =>
      tx.outboxEmail.findFirstOrThrow({ where: { organizationId: orgB } }),
    );
    await expect(
      withTenant(orgA, (tx) => tx.outboxEmail.delete({ where: { id: other.id } }), prisma),
    ).rejects.toThrow();
    await withTenant(orgA, (tx) => tx.outboxEmail.deleteMany(), prisma);
    expect(await sys((tx) => tx.outboxEmail.count({ where: { organizationId: orgB } }))).toBe(1);
    expect(await sys((tx) => tx.outboxEmail.count({ where: { organizationId: orgA } }))).toBe(0);
  });

  it('upsert cannot update or create into another org', async () => {
    const other = await sys((tx) =>
      tx.membership.findFirstOrThrow({ where: { organizationId: orgB } }),
    );
    // where is scoped to orgA, so the foreign row is never matched or updated
    await withTenant(
      orgA,
      (tx) =>
        tx.membership.upsert({
          where: { id: other.id },
          update: { status: 'inactive' },
          create: { id: other.id, userId: userB, organizationId: orgB, role: 'coach' },
        }),
      prisma,
    ).catch(() => undefined);
    const still = await sys((tx) => tx.membership.findUniqueOrThrow({ where: { id: other.id } }));
    expect(still.status).toBe('active');
  });

  it('nested membership create into another org is rejected', async () => {
    await expect(
      withTenant(
        orgA,
        (tx) =>
          tx.user.update({
            where: { id: userA },
            data: { memberships: { create: { organizationId: orgB, role: 'owner' } } },
          }),
        prisma,
      ),
    ).rejects.toThrow();
    expect(await membershipsOfB()).toBe(1);
  });

  it('nested deleteMany via organization cannot delete other orgs memberships', async () => {
    await withTenant(
      orgA,
      (tx) =>
        tx.organization.update({ where: { id: orgA }, data: { memberships: { deleteMany: {} } } }),
      prisma,
    );
    expect(await membershipsOfB()).toBe(1);
  });

  it('organization create is not allowed in a tenant scope', async () => {
    await expect(
      withTenant(
        orgA,
        (tx) =>
          tx.organization.create({ data: { name: 'x', timezone: 'UTC', ownerUserId: userA } }),
        prisma,
      ),
    ).rejects.toThrow(/not allowed/);
  });
});
