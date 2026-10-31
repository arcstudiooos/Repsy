import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { applyPause } from '../clients/pause';
import {
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import {
  getCheckin,
  getCheckinTemplate,
  issueDueCheckins,
  listCheckins,
  saveCheckinDraft,
  setCheckinWeekday,
  submitCheckin,
  updateCheckinTemplate,
  weekActivityBefore,
} from './checkins';
import { SEEDED_QUESTIONS } from './questions';

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

/** Wednesday 2026-11-04 (NOW is 08:00 in New York). */
const WEDNESDAY = 3;

async function world(weekday: number | null = WEDNESDAY): Promise<ClientWorld> {
  const w = await newClientWorld(prisma, await newOrg(prisma));
  if (weekday !== null) {
    await runAs(prisma, w.coach, (tx) => setCheckinWeekday(tx, w.coach, w.clientId, weekday));
  }
  return w;
}

const issue = (w: ClientWorld, now = NOW) =>
  runAs(prisma, w.coach, (tx) => issueDueCheckins(tx, now));

const checkinsOf = (w: ClientWorld) =>
  withSystem(
    (tx) =>
      tx.checkin.findMany({ where: { clientId: w.clientId }, orderBy: { periodLocalDate: 'asc' } }),
    prisma,
  );

const emailsOf = (w: ClientWorld) =>
  withSystem(
    (tx) =>
      tx.outboxEmail.count({ where: { organizationId: w.orgId, templateKey: 'checkin_ready' } }),
    prisma,
  );

describe('issueDueCheckins', () => {
  it('sweep x3 at the same instant → one check-in and one email', async () => {
    const w = await world();
    const results = [await issue(w), await issue(w), await issue(w)];
    expect(results.map((r) => r.issued)).toEqual([1, 0, 0]);
    const [c] = await checkinsOf(w);
    expect(c?.periodLocalDate.toISOString().slice(0, 10)).toBe('2026-11-04');
    // 06:00 and 23:59 in New York (EST after 2026-11-01).
    expect(c?.issuedAt.toISOString()).toBe('2026-11-04T11:00:00.000Z');
    expect(c?.dueAt.toISOString()).toBe('2026-11-05T04:59:00.000Z');
    expect(await emailsOf(w)).toBe(1);
  });

  it('before 06:00 local → none; other weekdays → none', async () => {
    const w = await world();
    expect((await issue(w, new Date('2026-11-04T10:59:00Z'))).issued).toBe(0);
    expect((await issue(w, new Date('2026-11-05T13:00:00Z'))).issued).toBe(0);
    expect(await checkinsOf(w)).toHaveLength(0);
  });

  it('paused week → none', async () => {
    const w = await world();
    await runAs(prisma, w.coach, (tx) =>
      applyPause(
        tx,
        w.coach,
        { clientId: w.clientId, startLocalDate: '2026-11-04', resumeLocalDate: '2026-11-10' },
        { now: new Date('2026-11-04T10:00:00Z') },
      ),
    );
    expect((await issue(w)).issued).toBe(0);
  });

  it('a pause booked for later stops nothing before it starts (PR #2 review B-I2)', async () => {
    const w = await world();
    await runAs(prisma, w.coach, (tx) =>
      applyPause(
        tx,
        w.coach,
        { clientId: w.clientId, startLocalDate: '2026-11-20', resumeLocalDate: '2026-11-27' },
        { now: new Date('2026-11-03T10:00:00Z') },
      ),
    );
    expect((await issue(w)).issued).toBe(1);
  });

  it('weekday change applies next period only', async () => {
    const w = await world();
    await issue(w); // Wednesday 11-04
    await runAs(prisma, w.coach, (tx) => setCheckinWeekday(tx, w.coach, w.clientId, 5));
    // Friday of the same week: too close to Wednesday's check-in.
    expect((await issue(w, new Date('2026-11-06T13:00:00Z'))).issued).toBe(0);
    // The next Friday issues.
    expect((await issue(w, new Date('2026-11-13T13:00:00Z'))).issued).toBe(1);
    const rows = await checkinsOf(w);
    expect(rows.map((r) => r.periodLocalDate.toISOString().slice(0, 10))).toEqual([
      '2026-11-04',
      '2026-11-13',
    ]);
  });

  it('no weekday → none; a template edit never changes an issued check-in', async () => {
    const none = await world(null);
    expect((await issue(none)).issued).toBe(0);

    const w = await world();
    await issue(w);
    await runAs(prisma, w.coach, (tx) =>
      updateCheckinTemplate(tx, w.coach, {
        questions: [{ id: 'mood', type: 'yes_no', label: 'Good week?' }],
      }),
    );
    const [c] = await runAs(prisma, w.client, (tx) => listCheckins(tx, w.client, {}, { now: NOW }));
    expect(c?.questions.map((q) => q.id)).toEqual(SEEDED_QUESTIONS.map((q) => q.id));
  });
});

describe('submitting', () => {
  async function issued() {
    const w = await world();
    await issue(w);
    const [row] = await checkinsOf(w);
    return { w, id: row!.id };
  }

  it('partial draft survives reload; coaches never see it', async () => {
    const { w, id } = await issued();
    await runAs(prisma, w.client, (tx) =>
      saveCheckinDraft(tx, w.client, id, { energy: 4, obstacles: ' Travel ', unknown: 'x' }),
    );
    const mine = await runAs(prisma, w.client, (tx) => getCheckin(tx, w.client, id, { now: NOW }));
    expect(mine).toMatchObject({
      status: 'open',
      draft: { energy: 4, obstacles: 'Travel' },
      answers: null,
    });
    const coach = await runAs(prisma, w.coach, (tx) => getCheckin(tx, w.coach, id, { now: NOW }));
    expect(coach.draft).toBeNull();
  });

  it('submit x2 with the same idempotencyKey → one submission; another key → CONFLICT', async () => {
    const { w, id } = await issued();
    const submit = (key: string, answers: unknown) =>
      runAs(prisma, w.client, (tx) =>
        submitCheckin(tx, w.client, id, { answers, idempotencyKey: key }, { now: NOW }),
      );
    const first = await submit('key-0000001', { energy: 3, sleep: 5, notes: 'All good' });
    const again = await submit('key-0000001', { energy: 1 });
    expect(again).toEqual(first);
    expect(first).toMatchObject({
      status: 'submitted',
      answers: { energy: 3, sleep: 5, notes: 'All good' },
    });
    expect(await codeOf(submit('key-0000002', {}))).toBe('CONFLICT');
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => saveCheckinDraft(tx, w.client, id, {}))),
    ).toBe('CONFLICT');
    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: id, action: 'checkin.submitted' } }),
      prisma,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadataJson).toEqual({ answered: 3 });
  });

  it('all questions omitted → valid submission; a wrong type → 422 on its answer', async () => {
    const { w, id } = await issued();
    const bad = await runAs(prisma, w.client, (tx) =>
      submitCheckin(tx, w.client, id, { answers: { energy: 9 }, idempotencyKey: 'key-bad-0001' }),
    ).catch((e: unknown) => e);
    expect(bad).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'answers.energy': ['Pick 1 to 5.'] },
    });
    const ok = await runAs(prisma, w.client, (tx) =>
      submitCheckin(tx, w.client, id, { idempotencyKey: 'key-empty-01' }, { now: NOW }),
    );
    expect(ok).toMatchObject({ status: 'submitted', answers: {} });
  });

  it('other org and sibling clients → NOT_FOUND; coaches cannot submit', async () => {
    const { w, id } = await issued();
    const sibling = await newClientWorld(prisma, { orgId: w.orgId, coach: w.coach });
    expect(
      await codeOf(runAs(prisma, sibling.client, (tx) => getCheckin(tx, sibling.client, id))),
    ).toBe('NOT_FOUND');
    const other = await newOrg(prisma);
    expect(await codeOf(runAs(prisma, other.coach, (tx) => getCheckin(tx, other.coach, id)))).toBe(
      'NOT_FOUND',
    );
    expect(
      await codeOf(
        runAs(prisma, other.coach, (tx) => listCheckins(tx, other.coach, { clientId: w.clientId })),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          submitCheckin(tx, w.coach, id, { idempotencyKey: 'key-coach-01' }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('template and activity', () => {
  it('the seeded template is created once and can be edited', async () => {
    const w = await world(null);
    const first = await runAs(prisma, w.coach, (tx) => getCheckinTemplate(tx, w.coach));
    const second = await runAs(prisma, w.coach, (tx) => getCheckinTemplate(tx, w.coach));
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ isSeeded: true, title: 'Weekly check-in' });
    const bad = await runAs(prisma, w.coach, (tx) =>
      updateCheckinTemplate(tx, w.coach, { questions: [] }),
    ).catch((e: unknown) => e);
    expect(bad).toMatchObject({ code: 'VALIDATION' });
    const edited = await runAs(prisma, w.coach, (tx) =>
      updateCheckinTemplate(tx, w.coach, { title: 'Friday check-in' }),
    );
    expect(edited).toMatchObject({ title: 'Friday check-in', isSeeded: false });
    expect(await codeOf(runAs(prisma, w.client, (tx) => getCheckinTemplate(tx, w.client)))).toBe(
      'FORBIDDEN',
    );
    expect(
      await codeOf(runAs(prisma, w.coach, (tx) => setCheckinWeekday(tx, w.coach, w.clientId, 8))),
    ).toBe('VALIDATION');
  });

  it('week activity counts the 7 days before the period', async () => {
    // Mon/Wed/Fri from Wednesday 11-04: sessions 11-04, 11-06, 11-09 ...
    const w = await world();
    const sessions = await withSystem(
      (tx) =>
        tx.workoutSession.findMany({
          where: { clientId: w.clientId },
          orderBy: { scheduledLocalDate: 'asc' },
        }),
      prisma,
    );
    await withSystem(
      (tx) =>
        tx.workoutSession.update({ where: { id: sessions[0]!.id }, data: { state: 'completed' } }),
      prisma,
    );
    const activity = await runAs(prisma, w.coach, (tx) =>
      weekActivityBefore(tx, w.coach, w.clientId, '2026-11-11'),
    );
    expect(activity).toEqual({
      fromLocalDate: '2026-11-04',
      toLocalDate: '2026-11-10',
      completed: 1,
      skipped: 0,
      missed: 0,
      total: 3,
    });
  });
});
