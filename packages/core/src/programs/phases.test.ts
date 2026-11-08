import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { commitProgramVersion } from './commit';
import { createProgram } from './read';
import { grid, newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { addPhase, advancePhases, listPhases } from './phases';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('phased programs (PRD C17, J5)', () => {
  it('starts the next phase after the running program ends; approve mode waits in review', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // workouts 4, 6, 9 Nov on Mon/Wed/Fri
    const next = await runAs(prisma, org.coach, async (tx) => {
      const p = await createProgram(tx, org.coach, { title: 'Strength' });
      await commitProgramVersion(tx, org.coach, {
        programId: p.id,
        expectedVersionNo: null,
        weeks: grid(1, 3),
      });
      return p;
    });
    await runAs(prisma, org.coach, (tx) =>
      addPhase(tx, org.coach, w.clientId, { templateProgramId: next.id, mode: 'auto' }),
    );
    expect(
      (await runAs(prisma, org.coach, (tx) => listPhases(tx, org.coach, w.clientId))).map(
        (p) => p.title,
      ),
    ).toEqual(['Strength']);
    // Still running on 9 Nov.
    expect(await advancePhases(prisma, new Date('2026-11-09T15:00:00Z'))).toEqual({
      started: 0,
      flagged: 0,
    });
    // 10 Nov: nothing planned from today, so the phase starts today on the same weekdays.
    expect(await advancePhases(prisma, new Date('2026-11-10T15:00:00Z'))).toEqual({
      started: 1,
      flagged: 0,
    });
    const active = await withSystem(
      (tx) =>
        tx.programAssignment.findFirstOrThrow({
          where: { clientId: w.clientId, status: 'active' },
          select: { weekdays: true, program: { select: { sourceProgramId: true } } },
        }),
      prisma,
    );
    expect(active.program.sourceProgramId).toBe(next.id);
    expect(active.weekdays).toEqual([1, 3, 5]);

    // Approve mode: a review item, no assignment until the coach starts it.
    await runAs(prisma, org.coach, (tx) =>
      addPhase(tx, org.coach, w.clientId, { templateProgramId: next.id, mode: 'approve' }),
    );
    expect(await advancePhases(prisma, new Date('2026-11-20T15:00:00Z'))).toEqual({
      started: 0,
      flagged: 1,
    });
    expect(await advancePhases(prisma, new Date('2026-11-20T16:00:00Z'))).toEqual({
      started: 0,
      flagged: 0,
    });
    const flag = await withSystem(
      (tx) => tx.reviewFlag.findFirstOrThrow({ where: { ruleKey: 'phase_ready' } }),
      prisma,
    );
    expect(flag.state).toBe('open');
  });
});
