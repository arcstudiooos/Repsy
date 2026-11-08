import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import type { ActorContext } from '../authz/actor';
import { newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { saveDraft } from './drafts';
import { duplicateTemplate } from './library';
import { createProgram, listPrograms, setProgramHouse } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('house templates (PRD C20)', () => {
  it('coaches see house templates and their own, use but not edit house ones', async () => {
    const org = await newOrg(prisma);
    const user = await withSystem(
      (tx) => tx.user.create({ data: { email: `bea-${Date.now()}@example.test`, name: 'Bea' } }),
      prisma,
    );
    await withSystem(
      (tx) =>
        tx.membership.create({
          data: { userId: user.id, organizationId: org.orgId, role: 'coach' },
        }),
      prisma,
    );
    const bea: ActorContext = {
      userId: user.id,
      orgId: org.orgId,
      role: 'coach',
      isPlatformAdmin: false,
    };
    const house = await runAs(prisma, org.coach, (tx) =>
      createProgram(tx, org.coach, { title: 'House block' }),
    );
    const ownerOnly = await runAs(prisma, org.coach, (tx) =>
      createProgram(tx, org.coach, { title: 'Owner private' }),
    );
    const mine = await runAs(prisma, bea, (tx) => createProgram(tx, bea, { title: 'Bea block' }));
    await expect(
      runAs(prisma, bea, (tx) => setProgramHouse(tx, bea, mine.id, true)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await runAs(prisma, org.coach, (tx) => setProgramHouse(tx, org.coach, house.id, true));

    const titles = async (a: ActorContext, library?: 'house' | 'mine') =>
      (await runAs(prisma, a, (tx) => listPrograms(tx, a, { kind: 'template', library }))).items
        .map((p) => p.title)
        .sort();
    expect(await titles(bea)).toEqual(['Bea block', 'House block']);
    expect(await titles(bea, 'house')).toEqual(['House block']);
    expect(await titles(org.coach)).toEqual(['Bea block', 'House block', 'Owner private']);
    void ownerOnly;

    await expect(
      runAs(prisma, bea, (tx) => saveDraft(tx, bea, house.id, { baseVersionNo: null, weeks: [] })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const copy = await runAs(prisma, bea, (tx) => duplicateTemplate(tx, bea, house.id));
    expect(copy.house).toBe(false);
    expect(await titles(bea, 'mine')).toContain(copy.title);
  });
});
