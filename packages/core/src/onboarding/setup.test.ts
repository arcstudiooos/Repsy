import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { getSetupChecklist, setSetupChecklistHidden } from './setup';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const done = (c: Awaited<ReturnType<typeof getSetupChecklist>>) =>
  c.steps.filter((s) => s.done).map((s) => s.id);

describe('setup checklist (PRD A5)', () => {
  it('starts empty, follows what exists, and hides per coach', async () => {
    const org = await newOrg(prisma);
    const fresh = await runAs(prisma, org.coach, (tx) => getSetupChecklist(tx, org.coach));
    expect(fresh).toMatchObject({ doneCount: 0, hidden: false });
    expect(fresh.steps).toHaveLength(7);

    // A client world has a template, a linked (invited) client and an assignment.
    await newClientWorld(prisma, org);
    const later = await runAs(prisma, org.coach, (tx) => getSetupChecklist(tx, org.coach));
    expect(done(later)).toEqual(expect.arrayContaining(['program', 'client', 'assign']));
    expect(done(later)).not.toContain('replies');

    await runAs(prisma, org.coach, (tx) =>
      tx.organization.update({ where: { id: org.orgId }, data: { replyTargetHours: 24 } }),
    );
    expect(
      done(await runAs(prisma, org.coach, (tx) => getSetupChecklist(tx, org.coach))),
    ).toContain('replies');

    await runAs(prisma, org.coach, (tx) => setSetupChecklistHidden(tx, org.coach, true));
    expect((await runAs(prisma, org.coach, (tx) => getSetupChecklist(tx, org.coach))).hidden).toBe(
      true,
    );
    await runAs(prisma, org.coach, (tx) => setSetupChecklistHidden(tx, org.coach, false));
    expect((await runAs(prisma, org.coach, (tx) => getSetupChecklist(tx, org.coach))).hidden).toBe(
      false,
    );
  });

  it('is coach-only', async () => {
    const org = await newOrg(prisma);
    const world = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, world.client, (tx) => getSetupChecklist(tx, world.client)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
