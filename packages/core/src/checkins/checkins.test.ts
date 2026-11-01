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
  checkinStreak,
  getCheckin,
  getCheckinTemplate,
  listCheckinsAwaitingReview,
  markCheckinReviewed,
  issueDueCheckins,
  listCheckins,
  saveCheckinDraft,
  setCheckinWeekday,
  submitCheckin,
  updateCheckinTemplate,
  weekActivityBefore,
  createCheckinTemplate,
  listCheckinTemplates,
  sendForm,
  updateCheckinTemplateById,
} from './checkins';
import { onCheckinSubmittedRules } from '../review/rules';
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

  it('every 2 or 4 weeks (PRD F4): skips the weeks in between; bad values are refused', async () => {
    const w = await world();
    await runAs(prisma, w.coach, (tx) =>
      setCheckinWeekday(tx, w.coach, w.clientId, WEDNESDAY, { everyWeeks: 2 }),
    );
    const wednesday = (weeks: number) =>
      new Date(new Date('2026-11-04T13:00:00Z').getTime() + weeks * 7 * 86_400_000);
    expect((await issue(w, wednesday(0))).issued).toBe(1);
    expect((await issue(w, wednesday(1))).issued).toBe(0);
    expect((await issue(w, wednesday(2))).issued).toBe(1);
    expect((await checkinsOf(w)).map((c) => c.periodLocalDate.toISOString().slice(0, 10))).toEqual([
      '2026-11-04',
      '2026-11-18',
    ]);
    // Leaving it out keeps the frequency.
    expect(
      await runAs(prisma, w.coach, (tx) => setCheckinWeekday(tx, w.coach, w.clientId, WEDNESDAY)),
    ).toEqual({ checkinWeekday: WEDNESDAY, checkinEveryWeeks: 2 });
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          setCheckinWeekday(tx, w.coach, w.clientId, WEDNESDAY, { everyWeeks: 3 }),
        ),
      ),
    ).toBe('VALIDATION');
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

describe('reviewed and streak (PRD F13, F14)', () => {
  async function submitted() {
    const w = await world();
    await issue(w);
    const [row] = await checkinsOf(w);
    return { w, id: row!.id };
  }

  it('a coach marks a sent check-in reviewed: the client sees it and its flag resolves', async () => {
    const { w, id } = await submitted();
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) => markCheckinReviewed(tx, w.coach, id, { now: NOW })),
      ),
    ).toBe('CONFLICT');
    await runAs(prisma, w.client, (tx) =>
      submitCheckin(
        tx,
        w.client,
        id,
        { answers: { energy: 4 }, idempotencyKey: 'key-review-01' },
        { now: NOW, onSubmitted: onCheckinSubmittedRules },
      ),
    );
    const later = new Date(NOW.getTime() + 3_600_000);
    const view = await runAs(prisma, w.coach, (tx) =>
      markCheckinReviewed(tx, w.coach, id, { now: later }),
    );
    expect(view.reviewedAt).toBe(later.toISOString());
    const again = await runAs(prisma, w.coach, (tx) =>
      markCheckinReviewed(tx, w.coach, id, { now: new Date(later.getTime() + 60_000) }),
    );
    expect(again.reviewedAt).toBe(later.toISOString());
    const seen = await runAs(prisma, w.client, (tx) => getCheckin(tx, w.client, id));
    expect(seen.reviewedAt).toBe(later.toISOString());
    const flag = await withSystem(
      (tx) => tx.reviewFlag.findFirst({ where: { ruleKey: 'checkin_new', sourceId: id } }),
      prisma,
    );
    expect(flag).toMatchObject({ state: 'resolved', resolvedBy: w.coach.userId });
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => markCheckinReviewed(tx, w.client, id))),
    ).toBe('FORBIDDEN');
  });

  it('streak counts on-time check-ins back from the newest; an open one is skipped, a late one ends it', async () => {
    const w = await world();
    const template = await runAs(prisma, w.coach, (tx) => getCheckinTemplate(tx, w.coach));
    const DAY = 86_400_000;
    const due = (d: string) => new Date(`${d}T04:59:00Z`); // 23:59 the day before in New York
    const rows: { period: string; submitted: Date | null }[] = [
      { period: '2026-10-07', submitted: due('2026-10-08') }, // on time
      { period: '2026-10-14', submitted: new Date(due('2026-10-15').getTime() + 3 * DAY) }, // late: ends it
      { period: '2026-10-21', submitted: due('2026-10-22') },
      { period: '2026-10-28', submitted: new Date(due('2026-10-29').getTime() + 12 * 3_600_000) }, // within grace
      { period: '2026-11-04', submitted: null }, // still open at NOW
    ];
    await withSystem(
      (tx) =>
        tx.checkin.createMany({
          data: rows.map((r) => ({
            organizationId: w.orgId,
            clientId: w.clientId,
            templateId: template.id,
            periodLocalDate: new Date(`${r.period}T00:00:00Z`),
            questionsJson: [],
            issuedAt: new Date(`${r.period}T11:00:00Z`),
            dueAt: due(
              new Date(Date.parse(`${r.period}T00:00:00Z`) + DAY).toISOString().slice(0, 10),
            ),
            submittedAt: r.submitted,
            answersJson: r.submitted ? {} : undefined,
            submitIdempotencyKey: r.submitted ? `key-${r.period}` : null,
          })),
        }),
      prisma,
    );
    const streak = (now: Date, as: 'coach' | 'client' = 'coach') =>
      runAs(prisma, as === 'coach' ? w.coach : w.client, (tx) =>
        checkinStreak(tx, as === 'coach' ? w.coach : w.client, { clientId: w.clientId }, { now }),
      );
    expect(await streak(NOW)).toBe(2);
    expect(await streak(NOW, 'client')).toBe(2);
    // Once the open one is past due + grace without a submission, the streak is 0.
    expect(await streak(new Date(NOW.getTime() + 4 * DAY))).toBe(0);
  });
});

describe('listCheckinsAwaitingReview (PRD I8)', () => {
  it('lists sent, unreviewed check-ins oldest first; reviewing removes one', async () => {
    const w = await world();
    await issue(w);
    const [row] = await checkinsOf(w);
    const before = await runAs(prisma, w.coach, (tx) => listCheckinsAwaitingReview(tx, w.coach));
    expect(before.total).toBe(0);
    await runAs(prisma, w.client, (tx) =>
      submitCheckin(
        tx,
        w.client,
        row!.id,
        { answers: { energy: 3 }, idempotencyKey: 'key-await-001' },
        { now: NOW },
      ),
    );
    const waiting = await runAs(prisma, w.coach, (tx) => listCheckinsAwaitingReview(tx, w.coach));
    expect(waiting).toMatchObject({ total: 1, items: [{ id: row!.id, clientName: 'Client' }] });
    await runAs(prisma, w.coach, (tx) => markCheckinReviewed(tx, w.coach, row!.id, { now: NOW }));
    expect(
      (await runAs(prisma, w.coach, (tx) => listCheckinsAwaitingReview(tx, w.coach))).total,
    ).toBe(0);
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => listCheckinsAwaitingReview(tx, w.client))),
    ).toBe('FORBIDDEN');
  });
});

describe('question types (PRD F3)', () => {
  const F3 = [
    { id: 'how', type: 'long_text', label: 'Tell me about your week', optional: true },
    { id: 'sleep_h', type: 'number', label: 'Average sleep', unit: 'hours', optional: true },
    {
      id: 'mood',
      type: 'single_choice',
      label: 'Mood',
      options: ['Good', 'Okay', 'Rough'],
      optional: true,
    },
    {
      id: 'aches',
      type: 'multi_choice',
      label: 'Any aches?',
      options: ['Knees', 'Back', 'Shoulders'],
      optional: true,
    },
    { id: 'trip', type: 'date', label: 'Next trip', optional: true },
    { id: 'kg', type: 'metric', label: 'Morning weight', metric: 'weight', optional: true },
  ];

  it('validates questions: options for choices, a measurement for metrics; extra fields dropped', async () => {
    const w = await world();
    const bad = (questions: unknown) =>
      codeOf(runAs(prisma, w.coach, (tx) => updateCheckinTemplate(tx, w.coach, { questions })));
    expect(await bad([{ id: 'a', type: 'single_choice', label: 'A', options: ['One'] }])).toBe(
      'VALIDATION',
    );
    expect(await bad([{ id: 'a', type: 'metric', label: 'A', metric: 'blood_sugar' }])).toBe(
      'VALIDATION',
    );
    const saved = await runAs(prisma, w.coach, (tx) =>
      updateCheckinTemplate(tx, w.coach, {
        questions: [{ id: 'a', type: 'short_text', label: 'A', options: ['x', 'y'], unit: 'u' }],
      }),
    );
    expect(saved.questions).toEqual([{ id: 'a', type: 'short_text', label: 'A', optional: true }]);
  });

  it('accepts each type, refuses wrong values, and records metric answers as measurements', async () => {
    const w = await world();
    await runAs(prisma, w.coach, (tx) => updateCheckinTemplate(tx, w.coach, { questions: F3 }));
    await issue(w);
    const [row] = await checkinsOf(w);
    const submit = (key: string, answers: unknown) =>
      runAs(prisma, w.client, (tx) =>
        submitCheckin(tx, w.client, row!.id, { answers, idempotencyKey: key }, { now: NOW }),
      );
    const wrong = await submit('key-f3-bad-01', {
      mood: 'Great',
      aches: ['Elbows'],
      trip: '2026-13-40',
      kg: 5,
    }).catch((e: unknown) => e);
    expect(wrong).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        'answers.mood': expect.any(Array),
        'answers.aches': expect.any(Array),
        'answers.trip': expect.any(Array),
        'answers.kg': expect.any(Array),
      },
    });
    const done = await submit('key-f3-ok-001', {
      how: '  Busy but good  ',
      sleep_h: 7.5,
      mood: 'Okay',
      aches: ['Shoulders', 'Knees', 'Knees'],
      trip: '2026-12-20',
      kg: 81.4,
    });
    expect(done.answers).toEqual({
      how: 'Busy but good',
      sleep_h: 7.5,
      mood: 'Okay',
      aches: ['Knees', 'Shoulders'],
      trip: '2026-12-20',
      kg: 81.4,
    });
    const entry = await withSystem(
      (tx) => tx.metricEntry.findFirst({ where: { clientId: w.clientId, metric: 'weight' } }),
      prisma,
    );
    expect(entry?.measuredOn.toISOString().slice(0, 10)).toBe('2026-11-04');
    expect(Number(entry?.value.toString())).toBe(81.4);
  });
});

describe('form library and intake (PRD F2, B12)', () => {
  const Q = (label: string, extra: Record<string, unknown> = {}) => [
    { id: 'q1', type: 'short_text', label, optional: true, ...extra },
  ];

  it('issues each client their own recurring template; forms never block a check-in', async () => {
    const w = await world(null);
    const mine = await runAs(prisma, w.coach, (tx) =>
      createCheckinTemplate(tx, w.coach, {
        title: 'Strength check',
        kind: 'checkin',
        questions: Q('Lifts?'),
      }),
    );
    await runAs(prisma, w.coach, (tx) =>
      setCheckinWeekday(tx, w.coach, w.clientId, WEDNESDAY, { templateId: mine.id }),
    );
    const form = await runAs(prisma, w.coach, (tx) =>
      createCheckinTemplate(tx, w.coach, {
        title: 'Injury history',
        kind: 'form',
        questions: Q('Any injuries?'),
      }),
    );
    const sent = await runAs(prisma, w.coach, (tx) =>
      sendForm(tx, w.coach, w.clientId, form.id, { now: NOW }),
    );
    expect(sent).toMatchObject({ kind: 'form', title: 'Injury history', status: 'open' });
    // A form isn't a check-in: it can't be scheduled, and today's check-in still goes out.
    expect(
      await codeOf(runAs(prisma, w.coach, (tx) => sendForm(tx, w.coach, w.clientId, mine.id))),
    ).toBe('VALIDATION');
    expect((await issue(w)).issued).toBe(1);
    const list = await runAs(prisma, w.client, (tx) => listCheckins(tx, w.client));
    expect(list.map((c) => [c.kind, c.title, c.questions[0]?.label])).toEqual(
      expect.arrayContaining([
        ['checkin', 'Strength check', 'Lifts?'],
        ['form', 'Injury history', 'Any injuries?'],
      ]),
    );
    // Archiving the client's template sends them back to the default; the default can't be archived.
    await runAs(prisma, w.coach, (tx) =>
      updateCheckinTemplateById(tx, w.coach, mine.id, { archived: true }),
    );
    const templates = await runAs(prisma, w.coach, (tx) => listCheckinTemplates(tx, w.coach));
    expect(templates.map((t) => t.title)).not.toContain('Strength check');
    const def = templates.find((t) => t.isDefault)!;
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          updateCheckinTemplateById(tx, w.coach, def.id, { archived: true }),
        ),
      ),
    ).toBe('VALIDATION');
  });

  it('intake answers fill the context card', async () => {
    const w = await world(null);
    const intake = await runAs(prisma, w.coach, (tx) =>
      createCheckinTemplate(tx, w.coach, {
        title: 'Welcome',
        kind: 'intake',
        questions: [
          { id: 'goal', type: 'long_text', label: 'Your goal', contextField: 'goals' },
          { id: 'kit', type: 'short_text', label: 'Your kit', contextField: 'equipmentNotes' },
        ],
      }),
    );
    expect(intake.questions[0]).toMatchObject({ contextField: 'goals' });
    // Only intake templates keep the mapping.
    const plain = await runAs(prisma, w.coach, (tx) =>
      createCheckinTemplate(tx, w.coach, {
        title: 'Plain',
        kind: 'form',
        questions: Q('x', { contextField: 'goals' }),
      }),
    );
    expect(plain.questions[0]).not.toHaveProperty('contextField');
    const sent = await runAs(prisma, w.coach, (tx) =>
      sendForm(tx, w.coach, w.clientId, intake.id, { now: NOW }),
    );
    await runAs(prisma, w.client, (tx) =>
      submitCheckin(
        tx,
        w.client,
        sent.id,
        {
          answers: { goal: 'Run a 10k', kit: 'Dumbbells at home' },
          idempotencyKey: 'key-intake-1',
        },
        { now: NOW },
      ),
    );
    const client = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: w.clientId } }),
      prisma,
    );
    expect(client).toMatchObject({ goals: 'Run a 10k', equipmentNotes: 'Dumbbells at home' });
  });
});
