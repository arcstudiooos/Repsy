import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { assignProgram } from '../assignments/assign';
import type { ActorContext } from '../authz/actor';
import {
  grid,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type Org,
} from '../sessions/fixtures.test-helpers';
import { commitProgramVersion } from './commit';
import { createProgram, getProgram, listPrograms, readStoredTargets } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('getProgram history reads', () => {
  it('renders a stored version whose targetJson is outside current bounds (lenient parse)', async () => {
    const seeded = await withSystem(async (tx) => {
      const user = await tx.user.create({ data: { email: 'o@example.test', name: 'O' } });
      const org = await tx.organization.create({
        data: { name: 'O', timezone: 'UTC', ownerUserId: user.id },
      });
      const program = await tx.program.create({
        data: { organizationId: org.id, title: 'Old', createdBy: user.id },
      });
      const wv = await tx.workoutVersion.create({
        data: { organizationId: org.id, title: 'Legacy', contentHash: 'x' },
      });
      // reps 5000, rpe 11 and loadKg 99999 would all fail today's strict targetSchema.
      await tx.workoutVersionExercise.create({
        data: {
          organizationId: org.id,
          workoutVersionId: wv.id,
          exerciseId: 'e0000000-0000-4000-8000-000000000001',
          position: 0,
          targetJson: [{ reps: 5000, rpe: 11, loadKg: 99999 }],
        },
      });
      const pv = await tx.programVersion.create({
        data: {
          organizationId: org.id,
          programId: program.id,
          versionNo: 1,
          committedBy: user.id,
          daysPerWeek: 1,
          weekCount: 1,
        },
      });
      await tx.programSlot.create({
        data: {
          organizationId: org.id,
          programVersionId: pv.id,
          weekIndex: 0,
          dayIndex: 0,
          workoutVersionId: wv.id,
        },
      });
      await tx.program.update({ where: { id: program.id }, data: { currentVersionId: pv.id } });
      return { userId: user.id, orgId: org.id, programId: program.id, versionId: pv.id };
    }, prisma);
    const actor: ActorContext = {
      userId: seeded.userId,
      orgId: seeded.orgId,
      role: 'owner',
      isPlatformAdmin: false,
    };
    const detail = await withTenant(
      seeded.orgId,
      (tx) => getProgram(tx, actor, seeded.programId, { versionId: seeded.versionId }),
      prisma,
    );
    expect(detail.weeks[0]!.days[0]!.exercises[0]!.sets).toEqual([
      { reps: 5000, rpe: 11, loadKg: 99999 },
    ]);
  });
});

describe('readStoredTargets (lenient history read)', () => {
  it('degrades unexpected shapes instead of throwing', () => {
    expect(readStoredTargets({ sets: 3 })).toEqual([]);
    expect(readStoredTargets(null)).toEqual([]);
    expect(
      readStoredTargets([
        { reps: 5, loadKg: 60, junk: 'x', rpe: 'hard', restSec: Number.NaN, tempo: '31X1' },
        null,
        'set',
        [1, 2],
        { durationSec: 30, distanceM: 400 },
      ]),
    ).toEqual([
      { reps: 5, loadKg: 60, tempo: '31X1' },
      { durationSec: 30, distanceM: 400 },
    ]);
  });
});

describe('listPrograms usage counts', () => {
  /** An active client in `org` with no program yet. */
  const addClient = (org: Org, name: string) =>
    withSystem(async (tx) => {
      const c = await tx.client.create({
        data: {
          organizationId: org.orgId,
          coachUserId: org.coach.userId,
          name,
          email: `${name.toLowerCase()}-${Date.now()}@example.test`,
          status: 'active',
          timezone: 'America/New_York',
        },
      });
      return c.id;
    }, prisma);
  const newTemplate = async (org: Org, title: string) => {
    const { id } = await runAs(prisma, org.coach, (tx) => createProgram(tx, org.coach, { title }));
    await runAs(prisma, org.coach, (tx) =>
      commitProgramVersion(tx, org.coach, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(1, 3),
      }),
    );
    return id;
  };
  const assign = (org: Org, clientId: string, templateProgramId: string, confirmReplace = false) =>
    runAs(prisma, org.coach, (tx) =>
      assignProgram(
        tx,
        org.coach,
        {
          clientId,
          templateProgramId,
          startLocalDate: '2026-11-04',
          weekdays: [1, 3, 5],
          readinessConfirmed: true,
          confirmReplace,
        },
        { now: NOW },
      ),
    );

  it('activeClientCount counts active assignments only', async () => {
    const org = await newOrg(prisma);
    // Ana runs the first template (through her own client copy).
    const ana = await newClientWorld(prisma, org);
    const block = ana.templateId;
    const other = await newTemplate(org, 'Other');
    const unused = await newTemplate(org, 'Unused');

    // Ben also runs it.
    await assign(org, await addClient(org, 'Ben'), block);
    // Cy ran it, then moved to the other template: his old copy's assignment is ended.
    const cy = await addClient(org, 'Cy');
    await assign(org, cy, block);
    await assign(org, cy, other, true);
    // Di's assignment of it ended without a replacement.
    const di = await addClient(org, 'Di');
    const diAssignment = await assign(org, di, block);
    await withSystem(
      (tx) =>
        tx.programAssignment.update({
          where: { id: diAssignment.assignmentId },
          data: { status: 'ended', endedAt: new Date() },
        }),
      prisma,
    );

    const { items } = await runAs(prisma, org.coach, (tx) =>
      listPrograms(tx, org.coach, { kind: 'template' }),
    );
    const count = Object.fromEntries(items.map((p) => [p.id, p.activeClientCount]));
    expect(count).toEqual({ [block]: 2, [other]: 1, [unused]: 0 });

    // Another org's assignments of its own templates never count here.
    const elsewhere = await newClientWorld(prisma, await newOrg(prisma));
    const again = await runAs(prisma, org.coach, (tx) =>
      listPrograms(tx, org.coach, { kind: 'template' }),
    );
    expect(again.items.map((p) => p.id)).not.toContain(elsewhere.templateId);
    expect(Object.fromEntries(again.items.map((p) => [p.id, p.activeClientCount]))).toEqual(count);
  });
});
