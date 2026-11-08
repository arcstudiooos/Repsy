import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { DomainError } from '../errors';
import { getSessionDetail } from '../sessions/detail';
import { completeSession, skipSession, startSession } from '../sessions/lifecycle';
import {
  newClientWorld,
  newOrg,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { reviseSetLogs } from './revise';
import { upsertSetLogs } from './upsertSetLogs';

let prisma: PrismaClient;
let drop: () => Promise<void>;

const MIN = 60_000;
const HOUR = 60 * MIN;

const failure = (p: Promise<unknown>) =>
  p.then(
    () => ({ code: 'ok' as string, fieldErrors: undefined as unknown, message: '' }),
    (e: unknown) =>
      e instanceof DomainError
        ? { code: e.code as string, fieldErrors: e.fieldErrors as unknown, message: e.message }
        : { code: `other:${String(e)}`, fieldErrors: undefined, message: '' },
  );
const codeOf = async (p: Promise<unknown>) => (await failure(p)).code;

const item = (
  wve: string,
  setIndex: number,
  over: Record<string, unknown> = {},
  at = new Date(Date.now() - HOUR),
) => ({
  workoutVersionExerciseId: wve,
  setIndex,
  reps: 8,
  weightKg: 60,
  clientUpdatedAt: at.toISOString(),
  clientMutationId: randomUUID(),
  ...over,
});

const revisions = (sessionId: string) =>
  withSystem(
    (tx) =>
      tx.setLogRevision.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      }),
    prisma,
  );
const audits = (sessionId: string, action: string) =>
  withSystem((tx) => tx.auditEvent.findMany({ where: { objectId: sessionId, action } }), prisma);

/**
 * A session the client started, logged (bench set 1: 8 × 60) and completed at `submittedAt`. Returns its id and the
 * two exercise row ids.
 */
async function finished(w: ClientWorld, opts: { index?: number; submittedAt?: Date } = {}) {
  const id = (await sessionsOf(prisma, w.assignmentId))[opts.index ?? 0]!.id;
  const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
  const bench = detail.workout.exercises[0]!.id;
  const press = detail.workout.exercises[1]!.id;
  await runAs(prisma, w.client, (tx) => upsertSetLogs(tx, w.client, id, [item(bench, 0)]));
  await runAs(prisma, w.client, (tx) =>
    completeSession(
      tx,
      w.client,
      id,
      { idempotencyKey: randomUUID() },
      { now: opts.submittedAt ?? new Date() },
    ),
  );
  return { id, bench, press };
}

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('reviseSetLogs', () => {
  it('client edit at 23h59m ok, at 24h01m → EDIT_WINDOW_CLOSED', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const submittedAt = new Date();
    const s = await finished(w, { submittedAt });
    const at = (ms: number) => new Date(submittedAt.getTime() + ms);

    const acks = await runAs(prisma, w.client, (tx) =>
      reviseSetLogs(
        tx,
        w.client,
        s.id,
        { items: [item(s.bench, 0, { reps: 10 })] },
        { now: at(23 * HOUR + 59 * MIN) },
      ),
    );
    expect(acks).toMatchObject([{ status: 'saved', value: { reps: 10, weightKg: 60 } }]);
    // The boundary itself is still open (inclusive).
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          reviseSetLogs(
            tx,
            w.client,
            s.id,
            { items: [item(s.bench, 0, { reps: 11 })] },
            { now: at(24 * HOUR) },
          ),
        ),
      ),
    ).toBe('ok');
    const late = await failure(
      runAs(prisma, w.client, (tx) =>
        reviseSetLogs(
          tx,
          w.client,
          s.id,
          { items: [item(s.bench, 0, { reps: 12 })] },
          { now: at(24 * HOUR + MIN) },
        ),
      ),
    );
    expect(late).toMatchObject({
      code: 'EDIT_WINDOW_CLOSED',
      message: 'You can edit a workout for 24 hours after finishing it.',
    });
    const rows = await revisions(s.id);
    expect(rows.map((r) => r.revisedByRole)).toEqual(['client', 'client']);
    expect(rows[0]).toMatchObject({
      beforeJson: { reps: 8, weightKg: 60, rpe: null, durationSeconds: null, distanceM: null },
      afterJson: { reps: 10, weightKg: 60, rpe: null, durationSeconds: null, distanceM: null },
      reason: null,
      revisedBy: w.userId,
    });
  });

  it('coach correction without reason → VALIDATION reason', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await finished(w);
    for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
      const res = await failure(
        runAs(prisma, w.coach, (tx) =>
          reviseSetLogs(tx, w.coach, s.id, { items: [item(s.bench, 0, { reps: 9 })], reason }),
        ),
      );
      expect(res.code, String(reason)).toBe('VALIDATION');
      expect(res.fieldErrors, String(reason)).toHaveProperty('reason');
    }
    const missing = await failure(
      runAs(prisma, w.coach, (tx) =>
        reviseSetLogs(tx, w.coach, s.id, { items: [item(s.bench, 0, { reps: 9 })] }),
      ),
    );
    expect(missing.fieldErrors).toEqual({ reason: ['Add a reason for the correction.'] });
    expect(await revisions(s.id)).toEqual([]);
  });

  it('coach correction after 30 days ok, writes revision and audit without the reason', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const submittedAt = new Date();
    const s = await finished(w, { submittedAt });
    const reason = 'Video shows 6 reps, not 8';
    const acks = await runAs(prisma, w.coach, (tx) =>
      reviseSetLogs(
        tx,
        w.coach,
        s.id,
        // A new set too: it did not exist, so its revision has no "before".
        {
          items: [item(s.bench, 0, { reps: 6 }), item(s.press, 0, { reps: 5 })],
          reason: ` ${reason} `,
        },
        { now: new Date(submittedAt.getTime() + 30 * 24 * HOUR) },
      ),
    );
    expect(acks.map((a) => a.value.reps)).toEqual([6, 5]);
    const rows = await revisions(s.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ reason, revisedBy: w.coach.userId, revisedByRole: 'coach' });
    }
    expect(rows.find((r) => r.beforeJson === null)?.afterJson).toMatchObject({ reps: 5 });
    const logs = await withSystem(
      (tx) => tx.setLog.findMany({ where: { sessionId: s.id } }),
      prisma,
    );
    expect(logs.map((l) => l.loggedByUserId)).toEqual([w.coach.userId, w.coach.userId]);

    const [audit, ...more] = await audits(s.id, 'session.logs_revised');
    expect(more).toEqual([]);
    expect(audit!.metadataJson).toEqual({ revisionCount: 2, role: 'coach' });
    expect(JSON.stringify(audit)).not.toContain('Video');
  });

  it('unchanged item writes no revision', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await finished(w);
    const acks = await runAs(prisma, w.client, (tx) =>
      reviseSetLogs(tx, w.client, s.id, {
        // Same values as stored; and an omitted field keeps its value.
        items: [item(s.bench, 0), { ...item(s.bench, 0), weightKg: undefined }],
      }),
    );
    expect(acks.map((a) => a.value.reps)).toEqual([8, 8]);
    expect(await revisions(s.id)).toEqual([]);
    expect(await audits(s.id, 'session.logs_revised')).toEqual([]);
  });

  it('a cleared set stays as an all-null row (Ruling 5)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await finished(w);
    await runAs(prisma, w.client, (tx) =>
      reviseSetLogs(tx, w.client, s.id, {
        items: [item(s.bench, 0, { reps: null, weightKg: null })],
      }),
    );
    const logs = await withSystem(
      (tx) => tx.setLog.findMany({ where: { sessionId: s.id } }),
      prisma,
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ reps: null, weightKg: null, rpe: null });
    const [rev] = await revisions(s.id);
    expect(rev!.afterJson).toEqual({
      reps: null,
      weightKg: null,
      rpe: null,
      durationSeconds: null,
      distanceM: null,
    });
  });

  it('workout version and its exercises unchanged after edits', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await finished(w);
    const snapshot = () =>
      withSystem(async (tx) => {
        const session = await tx.workoutSession.findUniqueOrThrow({ where: { id: s.id } });
        return {
          workoutVersionId: session.workoutVersionId,
          version: await tx.workoutVersion.findUniqueOrThrow({
            where: { id: session.workoutVersionId! },
          }),
          exercises: await tx.workoutVersionExercise.findMany({
            where: { workoutVersionId: session.workoutVersionId! },
            orderBy: { position: 'asc' },
          }),
        };
      }, prisma);
    const before = await snapshot();
    await runAs(prisma, w.client, (tx) =>
      reviseSetLogs(tx, w.client, s.id, { items: [item(s.bench, 0, { reps: 3, weightKg: 200 })] }),
    );
    await runAs(prisma, w.coach, (tx) =>
      reviseSetLogs(tx, w.coach, s.id, {
        items: [item(s.bench, 1, { reps: 1 })],
        reason: 'Missed set',
      }),
    );
    expect(await snapshot()).toEqual(before);
  });

  it('in_progress → CONFLICT; scheduled → SESSION_NOT_STARTED; foreign exercise → VALIDATION', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [first, second] = await sessionsOf(prisma, w.assignmentId);
    const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, first!.id));
    const bench = detail.workout.exercises[0]!.id;
    const res = await failure(
      runAs(prisma, w.client, (tx) =>
        reviseSetLogs(tx, w.client, first!.id, { items: [item(bench, 0)] }),
      ),
    );
    expect(res).toMatchObject({ code: 'CONFLICT', message: 'This workout is still in progress.' });
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          reviseSetLogs(tx, w.coach, second!.id, { items: [item(bench, 0)], reason: 'r' }),
        ),
      ),
    ).toBe('SESSION_NOT_STARTED');
    // A skipped session can be edited; an exercise outside its locked version cannot.
    await runAs(prisma, w.client, (tx) =>
      skipSession(tx, w.client, second!.id, { idempotencyKey: randomUUID() }),
    );
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          reviseSetLogs(tx, w.client, second!.id, { items: [item(randomUUID(), 0)] }),
        ),
      ),
    ).toBe('VALIDATION');
  });

  it('sibling client → NOT_FOUND; another org coach → NOT_FOUND', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const sibling = await newClientWorld(prisma, org);
    const s = await finished(w);
    expect(
      await codeOf(
        runAs(prisma, sibling.client, (tx) =>
          reviseSetLogs(tx, sibling.client, s.id, { items: [item(s.bench, 0, { reps: 1 })] }),
        ),
      ),
    ).toBe('NOT_FOUND');
    const far = await newOrg(prisma);
    expect(
      await codeOf(
        runAs(prisma, far.coach, (tx) =>
          reviseSetLogs(tx, far.coach, s.id, {
            items: [item(s.bench, 0, { reps: 1 })],
            reason: 'r',
          }),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(await revisions(s.id)).toEqual([]);
  });

  it('client sees reason null; the coach sees it; editableUntil for clients only', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const submittedAt = new Date();
    const s = await finished(w, { submittedAt });
    await runAs(prisma, w.client, (tx) =>
      reviseSetLogs(tx, w.client, s.id, {
        items: [item(s.bench, 0, { reps: 9 })],
        reason: 'My mistake',
      }),
    );
    await runAs(prisma, w.coach, (tx) =>
      reviseSetLogs(tx, w.coach, s.id, {
        items: [item(s.bench, 0, { reps: 10 })],
        reason: 'Form check',
      }),
    );
    const asClient = await runAs(prisma, w.client, (tx) => getSessionDetail(tx, w.client, s.id));
    expect(asClient.revisions).toEqual([
      expect.objectContaining({ role: 'client', reason: null, revisedByName: 'Client' }),
      expect.objectContaining({
        workoutVersionExerciseId: s.bench,
        setIndex: 0,
        before: expect.objectContaining({ reps: 9 }),
        after: expect.objectContaining({ reps: 10 }),
        role: 'coach',
        reason: null,
        revisedByName: 'Coach',
      }),
    ]);
    expect(asClient.editableUntil).toBe(new Date(submittedAt.getTime() + 24 * HOUR).toISOString());
    const asCoach = await runAs(prisma, w.coach, (tx) => getSessionDetail(tx, w.coach, s.id));
    expect(asCoach.revisions.map((r) => r.reason)).toEqual(['My mistake', 'Form check']);
    expect(asCoach.editableUntil).toBeNull();
  });
});
