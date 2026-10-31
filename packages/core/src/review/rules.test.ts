import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { submitCheckin } from '../checkins/checkins';
import { applyPause } from '../clients/pause';
import { getMyThread, listMessages, sendMessage } from '../messages/messages';
import { completeSession, startSession } from '../sessions/lifecycle';
import {
  grid,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { updateFlag } from './flags';
import { evaluateRules, onCheckinSubmittedRules } from './rules';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

/** Default: Mon/Wed/Fri from Wednesday 2026-11-04 (New York), sessions 11-04, 11-06, 11-09; grace 24h. */
async function freshWorld(opts: Parameters<typeof newClientWorld>[2] = {}, timezone?: string) {
  return newClientWorld(prisma, await newOrg(prisma, timezone), opts);
}

const sweep = (w: ClientWorld, now: Date) =>
  runAs(prisma, w.coach, (tx) => evaluateRules(tx, w.orgId, now));

const flagsOf = (w: ClientWorld) =>
  withSystem(
    (tx) =>
      tx.reviewFlag.findMany({ where: { clientId: w.clientId }, orderBy: { createdAt: 'asc' } }),
    prisma,
  );

const setState = (id: string, data: Record<string, unknown>) =>
  withSystem((tx) => tx.workoutSession.update({ where: { id }, data }), prisma);

/** 2026-11-10 12:00 UTC: 11-04 and 11-06 are past due + 24h; 11-09 is not. */
const AFTER = new Date('2026-11-10T12:00:00Z');

describe('derived session states', () => {
  it('unstarted past due + grace → missed (version locked); started → incomplete', async () => {
    const w = await freshWorld();
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    await setState(b!.id, { state: 'in_progress', startedAt: NOW });
    // Not yet: 11-04 is due 11-05 04:59 UTC, plus 24 hours.
    await sweep(w, new Date('2026-11-06T04:58:00Z'));
    expect((await sessionsOf(prisma, w.assignmentId))[0]?.state).toBe('scheduled');
    await sweep(w, AFTER);
    const rows = await sessionsOf(prisma, w.assignmentId);
    expect(rows.map((r) => r.state)).toEqual(['missed', 'incomplete', 'scheduled']);
    expect(rows[0]?.workoutVersionId).not.toBeNull();
    expect(a!.workoutVersionId).toBeNull();
  });

  it('timezone boundary: due 23:59 Pacific/Auckland with 0h grace is missed at that UTC instant', async () => {
    const w = await freshWorld(
      {
        timezone: 'Pacific/Auckland',
        startLocalDate: '2026-11-06',
        weekdays: [5],
        weeks: grid(1, 1),
        now: new Date('2026-11-03T00:00:00Z'),
      },
      'Pacific/Auckland',
    );
    await withSystem(
      (tx) => tx.organization.update({ where: { id: w.orgId }, data: { graceHours: 0 } }),
      prisma,
    );
    const [s] = await sessionsOf(prisma, w.assignmentId);
    // 23:59 NZDT (UTC+13) on 11-06.
    expect(s?.dueAt.toISOString()).toBe('2026-11-06T10:59:00.000Z');
    await sweep(w, new Date('2026-11-06T10:58:59Z'));
    expect((await sessionsOf(prisma, w.assignmentId))[0]?.state).toBe('scheduled');
    await sweep(w, new Date('2026-11-06T10:59:01Z'));
    expect((await sessionsOf(prisma, w.assignmentId))[0]?.state).toBe('missed');
  });
});

describe('Rule 1: missed workouts', () => {
  it('two missed + one skipped → one flag citing both; sweep twice → one flag', async () => {
    const w = await freshWorld({ weeks: grid(2, 3) });
    const rows = await sessionsOf(prisma, w.assignmentId);
    await setState(rows[2]!.id, { state: 'skipped' });
    const first = await sweep(w, AFTER);
    const second = await sweep(w, AFTER);
    expect([first.opened, second.opened]).toEqual([1, 0]);
    const flags = await flagsOf(w);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      ruleKey: 'missed_workouts',
      state: 'open',
      severity: 'needs_review',
    });
    expect(flags[0]?.evidenceJson).toMatchObject({
      rule: 'Missed 2 or more workouts in the last 7 days',
      sessionIds: [rows[0]!.id, rows[1]!.id],
      dates: ['2026-11-04', '2026-11-06'],
    });
  });

  it('one missed + one incomplete → no flag', async () => {
    const w = await freshWorld();
    const rows = await sessionsOf(prisma, w.assignmentId);
    await setState(rows[1]!.id, { state: 'in_progress', startedAt: NOW });
    await sweep(w, AFTER);
    expect(await flagsOf(w)).toHaveLength(0);
  });

  /** Books a pause through the real path (status `paused` at once, Ruling 6). */
  const pause = (w: ClientWorld, startLocalDate: string, resumeLocalDate: string) =>
    runAs(prisma, w.coach, (tx) =>
      applyPause(
        tx,
        w.coach,
        { clientId: w.clientId, startLocalDate, resumeLocalDate },
        { now: NOW },
      ),
    );

  it('a client inside a pause → no flag', async () => {
    const p = await freshWorld();
    await pause(p, '2026-11-09', '2026-11-20');
    await sweep(p, AFTER);
    expect(await flagsOf(p)).toHaveLength(0);
  });

  it('a pause booked for later stops nothing before it starts (PR #2 review B-I2)', async () => {
    const p = await freshWorld();
    await pause(p, '2026-11-20', '2026-11-27');
    expect(
      (await withSystem((tx) => tx.client.findUniqueOrThrow({ where: { id: p.clientId } }), prisma))
        .status,
    ).toBe('paused');
    await sweep(p, AFTER);
    expect((await flagsOf(p)).map((f) => f.ruleKey)).toEqual(['missed_workouts']);
  });

  it('after the coach resolves a flag, two new misses raise a new one citing them (PR #2 review B-I1)', async () => {
    const w = await freshWorld({ weeks: grid(2, 3) });
    const rows = await sessionsOf(prisma, w.assignmentId);
    await sweep(w, AFTER);
    const [first] = await flagsOf(w);
    await runAs(prisma, w.coach, (tx) =>
      updateFlag(
        tx,
        w.coach,
        first!.id,
        { action: 'resolve', reason: 'Talked to them' },
        { now: AFTER },
      ),
    );
    // One more miss (11-09) with an already handled one in the window: nothing.
    const later = new Date('2026-11-11T12:00:00Z');
    await sweep(w, later);
    expect(await flagsOf(w)).toHaveLength(1);
    // A second new miss (11-11): a new flag citing only the new ones.
    const evenLater = new Date('2026-11-13T12:00:00Z');
    await sweep(w, evenLater);
    const flags = await flagsOf(w);
    expect(flags.map((f) => f.state)).toEqual(['resolved', 'open']);
    expect(flags[1]?.evidenceJson).toMatchObject({ sessionIds: [rows[2]!.id, rows[3]!.id] });
  });

  it('late offline completion of a missed session → the flag auto-resolves', async () => {
    const w = await freshWorld();
    await sweep(w, AFTER);
    const [flag] = await flagsOf(w);
    expect(flag?.state).toBe('open');
    const [first] = await sessionsOf(prisma, w.assignmentId);
    await runAs(prisma, w.client, (tx) => startSession(tx, w.client, first!.id, { now: AFTER }));
    await runAs(prisma, w.client, (tx) =>
      completeSession(
        tx,
        w.client,
        first!.id,
        { idempotencyKey: crypto.randomUUID() },
        { now: AFTER },
      ),
    );
    const [after] = await flagsOf(w);
    expect(after).toMatchObject({
      state: 'resolved',
      resolvedBy: null,
      resolutionReason: 'Resolved automatically',
    });
    // The resolved episode is not raised again by the next sweep.
    await sweep(w, AFTER);
    expect(await flagsOf(w)).toHaveLength(1);
  });
});

describe('Rules 2 and 3: check-ins', () => {
  async function withCheckin(w: ClientWorld) {
    return withSystem(async (tx) => {
      const template = await tx.checkinTemplate.create({
        data: {
          organizationId: w.orgId,
          title: 'Weekly',
          questionsJson: [{ id: 'energy', type: 'scale_1_5', label: 'Energy', optional: true }],
        },
      });
      return tx.checkin.create({
        data: {
          organizationId: w.orgId,
          clientId: w.clientId,
          templateId: template.id,
          periodLocalDate: new Date('2026-11-04'),
          questionsJson: template.questionsJson as never,
          issuedAt: new Date('2026-11-04T11:00:00Z'),
          dueAt: new Date('2026-11-05T04:59:00Z'),
        },
      });
    }, prisma);
  }

  it('overdue after due + grace; sending it resolves the overdue flag and opens "New check-in sent"', async () => {
    const w = await freshWorld({ weeks: grid(1, 1), weekdays: [3] });
    const c = await withCheckin(w);
    await sweep(w, new Date('2026-11-06T04:58:00Z'));
    expect(await flagsOf(w)).toHaveLength(0);
    await sweep(w, new Date('2026-11-06T05:00:00Z'));
    expect((await flagsOf(w)).map((f) => [f.ruleKey, f.state])).toEqual([
      ['checkin_overdue', 'open'],
    ]);

    const now = new Date('2026-11-06T09:00:00Z');
    await runAs(prisma, w.client, (tx) =>
      submitCheckin(
        tx,
        w.client,
        c.id,
        { answers: { energy: 2 }, idempotencyKey: 'key-rules-01' },
        { now, onSubmitted: onCheckinSubmittedRules },
      ),
    );
    const flags = await flagsOf(w);
    expect(flags.map((f) => [f.ruleKey, f.state])).toEqual([
      ['checkin_overdue', 'resolved'],
      ['checkin_new', 'open'],
    ]);
    expect(JSON.stringify(flags[1]?.evidenceJson)).not.toContain('energy');
  });
});

describe('Rule 4: unread client messages', () => {
  it('only for an opted-in coach, after 24 hours; reading resolves it', async () => {
    const w = await freshWorld();
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    await runAs(prisma, w.client, (tx) =>
      sendMessage(tx, w.client, thread.id, { body: 'Question about Friday' }, { now: NOW }),
    );
    const later = new Date(NOW.getTime() + 25 * 3_600_000);
    await sweep(w, later);
    expect((await flagsOf(w)).filter((f) => f.ruleKey === 'message_unread')).toHaveLength(0);

    await withSystem(
      (tx) =>
        tx.notificationPreference.create({
          data: { userId: w.coach.userId, messageEmailOptIn: true },
        }),
      prisma,
    );
    await sweep(w, new Date(NOW.getTime() + 23 * 3_600_000));
    expect((await flagsOf(w)).filter((f) => f.ruleKey === 'message_unread')).toHaveLength(0);
    await sweep(w, later);
    expect(
      (await flagsOf(w)).filter((f) => f.ruleKey === 'message_unread').map((f) => f.state),
    ).toEqual(['open']);

    await runAs(prisma, w.coach, (tx) => listMessages(tx, w.coach, thread.id, {}, { now: later }));
    await sweep(w, later);
    expect(
      (await flagsOf(w)).filter((f) => f.ruleKey === 'message_unread').map((f) => f.state),
    ).toEqual(['resolved']);
  });
});

describe('Rule 4 after a resolve', () => {
  it('a later unread message raises a new flag when the coach resolved without reading (PR #2 review B-I1)', async () => {
    const w = await freshWorld();
    await withSystem(
      (tx) =>
        tx.notificationPreference.create({
          data: { userId: w.coach.userId, messageEmailOptIn: true },
        }),
      prisma,
    );
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    const say = (body: string, at: Date) =>
      runAs(prisma, w.client, (tx) => sendMessage(tx, w.client, thread.id, { body }, { now: at }));
    await say('First', NOW);
    const day1 = new Date(NOW.getTime() + 25 * 3_600_000);
    await sweep(w, day1);
    const [flag] = (await flagsOf(w)).filter((f) => f.ruleKey === 'message_unread');
    await runAs(prisma, w.coach, (tx) =>
      updateFlag(
        tx,
        w.coach,
        flag!.id,
        { action: 'dismiss', reason: 'Answered by phone' },
        { now: day1 },
      ),
    );
    await sweep(w, day1);
    expect((await flagsOf(w)).filter((f) => f.ruleKey === 'message_unread')).toHaveLength(1);

    const second = await say('Second', new Date(day1.getTime() + 60_000));
    await sweep(w, new Date(day1.getTime() + 25 * 3_600_000));
    const flags = (await flagsOf(w)).filter((f) => f.ruleKey === 'message_unread');
    expect(flags.map((f) => [f.state, f.sourceId])).toEqual([
      ['dismissed', flag!.sourceId],
      ['open', second.id],
    ]);
  });
});

describe('snoozes', () => {
  it('a snooze that ran out reopens the flag', async () => {
    const w = await freshWorld();
    await sweep(w, AFTER);
    const [flag] = await flagsOf(w);
    await withSystem(
      (tx) =>
        tx.reviewFlag.update({
          where: { id: flag!.id },
          data: { state: 'snoozed', snoozedUntil: new Date('2026-11-11T00:00:00Z') },
        }),
      prisma,
    );
    expect((await sweep(w, new Date('2026-11-10T23:00:00Z'))).reopened).toBe(0);
    expect((await sweep(w, new Date('2026-11-11T00:00:01Z'))).reopened).toBe(1);
    expect((await flagsOf(w))[0]).toMatchObject({ state: 'open', snoozedUntil: null });
    expect((await flagsOf(w))[0]?.reopenedAt).not.toBeNull();
  });
});
