import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { DomainError } from '../errors';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import {
  commitClientCopyVersion,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
  type ClientWorld,
} from './fixtures.test-helpers';
import { getSessionDetail } from './detail';
import { completeSession, skipSession, startSession } from './lifecycle';

let prisma: PrismaClient;
let drop: () => Promise<void>;

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );
const audits = (objectId: string, action: string) =>
  withSystem((tx) => tx.auditEvent.count({ where: { objectId, action } }), prisma);
const row = (id: string) =>
  withSystem((tx) => tx.workoutSession.findUniqueOrThrow({ where: { id } }), prisma);
const firstSession = async (w: ClientWorld) => (await sessionsOf(prisma, w.assignmentId))[0]!.id;
const finish = () => ({ idempotencyKey: randomUUID() });

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('startSession', () => {
  it('locks the current version and is idempotent', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const id = await firstSession(w);
    const started = await runAs(prisma, w.client, (tx) =>
      startSession(tx, w.client, id, { now: NOW }),
    );
    expect(started.session).toMatchObject({ state: 'in_progress', loggedByCoach: false });
    expect(started.workout.locked).toBe(true);
    const again = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
    expect(again.session.workoutVersionId).toBe(started.session.workoutVersionId);
    expect(await audits(id, 'session.started')).toBe(1);
    expect((await row(id)).startedAt).toEqual(NOW);
  });

  it('concurrent starts lock once', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const id = await firstSession(w);
    const results = await Promise.all(
      [1, 2, 3].map(() => runAs(prisma, w.client, (tx) => startSession(tx, w.client, id))),
    );
    expect(new Set(results.map((r) => r.session.workoutVersionId)).size).toBe(1);
    expect(await audits(id, 'session.started')).toBe(1);
  });

  it('locks the version current at start; a later commit leaves it unchanged (Review Focus #4)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const id = await firstSession(w);
    const v2 = await commitClientCopyVersion(prisma, w, 'Version two');
    const started = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
    expect(started.session.workoutVersionId).toBe(v2);
    await commitClientCopyVersion(prisma, w, 'Version three');
    expect((await row(id)).workoutVersionId).toBe(v2);
    const read = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
    expect(read.workout.title).toBe('Version two');
  });

  it("finished and cancelled sessions can't start; another client's session is NOT_FOUND", async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, org);
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    await withSystem(
      (tx) => tx.workoutSession.update({ where: { id: a!.id }, data: { state: 'cancelled' } }),
      prisma,
    );
    expect(await codeOf(runAs(prisma, w.client, (tx) => startSession(tx, w.client, a!.id)))).toBe(
      'SESSION_FINISHED',
    );
    await runAs(prisma, w.client, (tx) => completeSession(tx, w.client, b!.id, finish()));
    expect(await codeOf(runAs(prisma, w.client, (tx) => startSession(tx, w.client, b!.id)))).toBe(
      'SESSION_FINISHED',
    );
    const theirs = await firstSession(other);
    expect(await codeOf(runAs(prisma, w.client, (tx) => startSession(tx, w.client, theirs)))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(runAs(prisma, w.client, (tx) => startSession(tx, w.client, 'x')))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('completeSession / skipSession', () => {
  it('complete x3 → one completion, one audit (Review Focus #2)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const id = await firstSession(w);
    await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
    const body = { idempotencyKey: randomUUID(), comment: '  Felt strong  ' };
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await runAs(prisma, w.client, (tx) => completeSession(tx, w.client, id, body)));
    }
    expect(results.map((r) => r.session.state)).toEqual(['completed', 'completed', 'completed']);
    expect(results[0]!.session.comment).toBe('Felt strong');
    expect(await audits(id, 'session.completed')).toBe(1);
    const audit = await withSystem(
      (tx) =>
        tx.auditEvent.findFirstOrThrow({ where: { objectId: id, action: 'session.completed' } }),
      prisma,
    );
    expect(JSON.stringify(audit.metadataJson)).not.toContain('Felt strong');
  });

  it('concurrent completes write once', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const id = await firstSession(w);
    const body = finish();
    await Promise.all(
      [1, 2, 3].map(() => runAs(prisma, w.client, (tx) => completeSession(tx, w.client, id, body))),
    );
    expect(await audits(id, 'session.completed')).toBe(1);
  });

  it('skip without start locks the version; the other action afterwards is SESSION_FINISHED', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    const skipped = await runAs(prisma, w.client, (tx) =>
      skipSession(tx, w.client, a!.id, finish()),
    );
    expect(skipped.session.state).toBe('skipped');
    expect((await row(a!.id)).workoutVersionId).not.toBeNull();
    expect((await row(a!.id)).completedAt).toBeNull();
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => completeSession(tx, w.client, a!.id, finish()))),
    ).toBe('SESSION_FINISHED');
    await runAs(prisma, w.client, (tx) => completeSession(tx, w.client, b!.id, finish()));
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => skipSession(tx, w.client, b!.id, finish()))),
    ).toBe('SESSION_FINISHED');
    const long = { idempotencyKey: randomUUID(), comment: 'x'.repeat(1001) };
    const [, , c] = await sessionsOf(prisma, w.assignmentId);
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => skipSession(tx, w.client, c!.id, long))),
    ).toBe('VALIDATION');
  });
});

describe('coach-logged sessions (D-008 #7)', () => {
  it('a coach write sets loggedByUserId and audits logged_by_coach once; client writes never do', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    const started = await runAs(prisma, w.coach, (tx) => startSession(tx, w.coach, a!.id));
    const benchSet = started.workout.exercises[0]!.id;
    await runAs(prisma, w.coach, (tx) =>
      upsertSetLogs(tx, w.coach, a!.id, [
        {
          workoutVersionExerciseId: benchSet,
          setIndex: 0,
          reps: 8,
          weightKg: 60,
          clientUpdatedAt: new Date().toISOString(),
          clientMutationId: randomUUID(),
        },
      ]),
    );
    const done = await runAs(prisma, w.coach, (tx) =>
      completeSession(tx, w.coach, a!.id, finish()),
    );
    expect(done.session.loggedByCoach).toBe(true);
    expect((await row(a!.id)).loggedByUserId).toBe(w.coach.userId);
    expect(await audits(a!.id, 'session.logged_by_coach')).toBe(1);

    await runAs(prisma, w.client, (tx) => startSession(tx, w.client, b!.id));
    await runAs(prisma, w.client, (tx) => completeSession(tx, w.client, b!.id, finish()));
    expect((await row(b!.id)).loggedByUserId).toBeNull();
    expect(await audits(b!.id, 'session.logged_by_coach')).toBe(0);
  });

  it("a coach can't reach another org's session", async () => {
    const a = await newClientWorld(prisma, await newOrg(prisma));
    const b = await newClientWorld(prisma, await newOrg(prisma));
    const theirs = await firstSession(b);
    expect(await codeOf(runAs(prisma, a.coach, (tx) => startSession(tx, a.coach, theirs)))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('archived clients and cancelled sessions', () => {
  it('nobody starts, logs or finishes for an archived client (D-010 #4)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    await runAs(prisma, w.client, (tx) => startSession(tx, w.client, b!.id));
    await withSystem(
      (tx) => tx.client.update({ where: { id: w.clientId }, data: { status: 'archived' } }),
      prisma,
    );
    for (const actor of [w.client, w.coach]) {
      expect(await codeOf(runAs(prisma, actor, (tx) => startSession(tx, actor, a!.id)))).toBe(
        'NOT_FOUND',
      );
      expect(
        await codeOf(runAs(prisma, actor, (tx) => completeSession(tx, actor, b!.id, finish()))),
      ).toBe('NOT_FOUND');
    }
    expect((await row(b!.id)).state).toBe('in_progress');
    // History stays readable for the coach.
    const detail = await runAs(prisma, w.coach, (tx) => getSessionDetail(tx, w.coach, b!.id));
    expect(detail.session.state).toBe('in_progress');
  });

  it('a cancelled session does not open', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const id = await firstSession(w);
    await withSystem(
      (tx) => tx.workoutSession.update({ where: { id }, data: { state: 'cancelled' } }),
      prisma,
    );
    expect(await codeOf(runAs(prisma, w.client, (tx) => getSessionDetail(tx, w.client, id)))).toBe(
      'NOT_FOUND',
    );
  });
});
