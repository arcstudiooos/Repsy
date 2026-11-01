import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { getPortalHome } from '../sessions/read';
import {
  grid,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { getClient, updateClient } from './clients';
import { applyPause, endDuePause, resumeNow, updatePause } from './pause';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

/** A 2-day program on Mon/Thu from Monday 2026-11-09 (New York): W1 11-09/11-12 ... W4 11-30/12-03. */
const world = async (weeks = 4) =>
  newClientWorld(prisma, await newOrg(prisma), {
    weeks: grid(weeks, 2),
    weekdays: [1, 4],
    startLocalDate: '2026-11-09',
  });

const localDate = (d: Date) => d.toISOString().slice(0, 10);

/** `W{week}D{day}` → scheduled local date. */
const dates = async (w: ClientWorld) =>
  Object.fromEntries(
    (await sessionsOf(prisma, w.assignmentId)).map((s) => [
      `W${s.slotWeekIndex! + 1}D${s.slotDayIndex! + 1}`,
      localDate(s.scheduledLocalDate),
    ]),
  );

const byKey = async (w: ClientWorld, key: string) =>
  (await sessionsOf(prisma, w.assignmentId)).find(
    (s) => `W${s.slotWeekIndex! + 1}D${s.slotDayIndex! + 1}` === key,
  )!;

const setState = (id: string, data: Record<string, unknown>) =>
  withSystem((tx) => tx.workoutSession.update({ where: { id }, data }), prisma);

const pause = (w: ClientWorld, start: string, resume: string, now = NOW) =>
  runAs(prisma, w.coach, (tx) =>
    applyPause(
      tx,
      w.coach,
      { clientId: w.clientId, startLocalDate: start, resumeLocalDate: resume },
      { now },
    ),
  );

const audits = (w: ClientWorld, action: string) =>
  withSystem((tx) => tx.auditEvent.count({ where: { objectId: w.clientId, action } }), prisma);

describe('applyPause', () => {
  it('applyPause twice shifts once', async () => {
    const w = await world();
    const first = await pause(w, '2026-11-23', '2026-11-30');
    const after = await dates(w);
    const second = await pause(w, '2026-11-23', '2026-11-30');
    expect(second).toEqual({ pauseId: first.pauseId, shifted: 0 });
    expect(await dates(w)).toEqual(after);
    expect(await audits(w, 'client.paused')).toBe(1);
    // Different dates while a pause is open is a conflict, not a second shift.
    expect(await codeOf(pause(w, '2026-11-23', '2026-12-01'))).toBe('CONFLICT');
  });

  it('Week 3 Monday resumes as Week 3', async () => {
    const w = await world();
    for (const key of ['W1D1', 'W1D2', 'W2D1', 'W2D2']) {
      await setState((await byKey(w, key)).id, { state: 'completed', completedAt: NOW });
    }
    const res = await pause(w, '2026-11-23', '2026-11-30');
    expect(res.shifted).toBe(4);
    expect(await dates(w)).toEqual({
      W1D1: '2026-11-09',
      W1D2: '2026-11-12',
      W2D1: '2026-11-16',
      W2D2: '2026-11-19',
      W3D1: '2026-11-30',
      W3D2: '2026-12-03',
      W4D1: '2026-12-07',
      W4D2: '2026-12-10',
    });
    expect((await byKey(w, 'W3D1')).pauseOffsetDays).toBe(7);
    expect((await byKey(w, 'W2D2')).pauseOffsetDays).toBe(0);
    const view = await runAs(prisma, w.coach, (tx) => getClient(tx, w.coach, w.clientId));
    expect(view).toMatchObject({
      status: 'paused',
      pause: { startLocalDate: '2026-11-23', resumeLocalDate: '2026-11-30' },
    });
    const home = await runAs(prisma, w.client, (tx) => getPortalHome(tx, w.client, { now: NOW }));
    expect(home.pause).toEqual({ startLocalDate: '2026-11-23', resumeLocalDate: '2026-11-30' });
  });

  it('DST-crossing shift keeps 23:59 local', async () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const w = await newClientWorld(prisma, await newOrg(prisma), {
      weeks: grid(2, 1),
      weekdays: [6],
      startLocalDate: '2026-10-30',
      now,
    });
    expect(localDate((await byKey(w, 'W1D1')).scheduledLocalDate)).toBe('2026-10-31');
    await pause(w, '2026-10-30', '2026-11-06', now);
    const moved = await byKey(w, 'W1D1');
    expect(localDate(moved.scheduledLocalDate)).toBe('2026-11-07');
    expect(moved.dueAt.toISOString()).toBe('2026-11-08T04:59:00.000Z');
    expect(moved.scheduledAt.toISOString()).toBe('2026-11-07T05:00:00.000Z');
  });

  it('completed and in_progress sessions unchanged; missed before the pause stays', async () => {
    const w = await world();
    const now = new Date('2026-11-17T15:00:00Z'); // Tuesday
    // W1D1 (11-09) was never logged: past-due history. W2D2 (11-19) is completed early, W3D1 (11-23) started.
    await setState((await byKey(w, 'W1D2')).id, { state: 'completed', completedAt: NOW });
    await setState((await byKey(w, 'W2D1')).id, { state: 'skipped' });
    await setState((await byKey(w, 'W2D2')).id, { state: 'completed', completedAt: now });
    await setState((await byKey(w, 'W3D1')).id, { state: 'in_progress', startedAt: now });
    const res = await pause(w, '2026-11-17', '2026-11-24', now);
    expect(res.shifted).toBe(3);
    expect(await dates(w)).toEqual({
      W1D1: '2026-11-09',
      W1D2: '2026-11-12',
      W2D1: '2026-11-16',
      W2D2: '2026-11-19',
      W3D1: '2026-11-23',
      W3D2: '2026-12-03',
      W4D1: '2026-12-07',
      W4D2: '2026-12-10',
    });
  });

  it('validates dates, status and access', async () => {
    const w = await world();
    expect(await codeOf(pause(w, '2026-11-03', '2026-11-10'))).toBe('VALIDATION');
    expect(await codeOf(pause(w, '2026-11-10', '2026-11-10'))).toBe('VALIDATION');
    expect(await codeOf(pause(w, '2026-11-10', '2027-02-09'))).toBe('VALIDATION');
    expect(await codeOf(pause(w, '2026-11-10', '2026-02-30'))).toBe('VALIDATION');
    // 90 days is the longest pause.
    expect(await codeOf(pause(w, '2026-11-10', '2027-02-08'))).toBe('ok');

    const other = await newOrg(prisma);
    expect(
      await codeOf(
        runAs(prisma, other.coach, (tx) =>
          applyPause(tx, other.coach, {
            clientId: w.clientId,
            startLocalDate: '2026-11-10',
            resumeLocalDate: '2026-11-17',
          }),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) => resumeNow(tx, w.client, { clientId: w.clientId })),
      ),
    ).toBe('FORBIDDEN');
  });

  it('PATCH status to or from paused → VALIDATION; archiving ends the pause', async () => {
    const w = await world();
    const patch = (status: 'paused' | 'active' | 'archived') =>
      runAs(prisma, w.coach, (tx) => updateClient(tx, w.coach, w.clientId, { status }));
    expect(await codeOf(patch('paused'))).toBe('VALIDATION');
    await pause(w, '2026-11-23', '2026-11-30');
    expect(await codeOf(patch('active'))).toBe('VALIDATION');
    const archived = await patch('archived');
    expect(archived).toMatchObject({ status: 'archived', pause: null });
    // The worker never revives an archived client.
    expect(
      await runAs(prisma, w.coach, (tx) =>
        endDuePause(tx, w.orgId, w.clientId, new Date('2026-12-01T12:00:00Z')),
      ),
    ).toBe(false);
  });
});

describe('updatePause', () => {
  const update = (w: ClientWorld, resume: string, now = NOW) =>
    runAs(prisma, w.coach, (tx) =>
      updatePause(tx, w.coach, { clientId: w.clientId, resumeLocalDate: resume }, { now }),
    );

  it('updatePause twice to the same date shifts once', async () => {
    const w = await world();
    await pause(w, '2026-11-23', '2026-11-30');
    expect((await update(w, '2026-12-07')).shifted).toBe(4);
    expect(await update(w, '2026-12-07')).toEqual({ shifted: 0 });
    expect((await dates(w)).W3D1).toBe('2026-12-07');
    expect((await byKey(w, 'W3D1')).pauseOffsetDays).toBe(14);
    expect(await audits(w, 'client.pause_updated')).toBe(1);
  });

  it('shorter resume pulls back by the delta', async () => {
    const w = await world();
    await pause(w, '2026-11-23', '2026-12-07');
    expect((await dates(w)).W3D1).toBe('2026-12-07');
    await update(w, '2026-11-26');
    expect(await dates(w)).toMatchObject({
      W2D2: '2026-11-19',
      W3D1: '2026-11-26',
      W3D2: '2026-11-29',
      W4D1: '2026-12-03',
    });
    expect((await byKey(w, 'W3D1')).pauseOffsetDays).toBe(3);
  });

  it('needs an open pause and a valid date', async () => {
    const w = await world();
    expect(await codeOf(update(w, '2026-11-30'))).toBe('NOT_FOUND');
    await pause(w, '2026-11-23', '2026-11-30');
    expect(await codeOf(update(w, '2026-11-23'))).toBe('VALIDATION');
    expect(await codeOf(update(w, '2027-03-01'))).toBe('VALIDATION');
  });
});

describe('resumeNow', () => {
  const resume = (w: ClientWorld, now: Date) =>
    runAs(prisma, w.coach, (tx) => resumeNow(tx, w.coach, { clientId: w.clientId }, { now }));

  it('resumeNow mid-pause pulls sessions back to today', async () => {
    const w = await world();
    await pause(w, '2026-11-23', '2026-11-30');
    const now = new Date('2026-11-25T15:00:00Z'); // Wednesday
    expect((await resume(w, now)).shifted).toBe(4);
    expect(await dates(w)).toMatchObject({
      W2D2: '2026-11-19',
      W3D1: '2026-11-25',
      W3D2: '2026-11-28',
    });
    const view = await runAs(prisma, w.coach, (tx) => getClient(tx, w.coach, w.clientId));
    expect(view).toMatchObject({ status: 'active', pause: null });
    // Nothing left to resume: a repeated Resume never shifts again.
    expect(await codeOf(resume(w, now))).toBe('NOT_FOUND');
    expect(await audits(w, 'client.resumed')).toBe(1);
  });

  it('resumeNow before start restores original dates', async () => {
    const w = await world();
    const before = await dates(w);
    await pause(w, '2026-11-23', '2026-11-30');
    await runAs(prisma, w.coach, (tx) =>
      updatePause(
        tx,
        w.coach,
        { clientId: w.clientId, resumeLocalDate: '2026-12-14' },
        { now: NOW },
      ),
    );
    await resume(w, NOW);
    expect(await dates(w)).toEqual(before);
    for (const s of await sessionsOf(prisma, w.assignmentId)) expect(s.pauseOffsetDays).toBe(0);
  });
});

describe('endDuePause', () => {
  it('ends a due pause once and never shifts sessions', async () => {
    const w = await world();
    await pause(w, '2026-11-23', '2026-11-30');
    const shifted = await dates(w);
    const end = (now: Date) =>
      runAs(prisma, w.coach, (tx) => endDuePause(tx, w.orgId, w.clientId, now));
    expect(await end(new Date('2026-11-29T12:00:00Z'))).toBe(false);
    expect(await end(new Date('2026-11-30T12:00:00Z'))).toBe(true);
    expect(await end(new Date('2026-11-30T12:00:00Z'))).toBe(false);
    expect(await dates(w)).toEqual(shifted);
    const view = await runAs(prisma, w.coach, (tx) => getClient(tx, w.coach, w.clientId));
    expect(view).toMatchObject({ status: 'active', pause: null });
  });
});
