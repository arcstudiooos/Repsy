import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { DomainError } from '../errors';
import { newClientWorld, newOrg, runAs, type ClientWorld } from '../sessions/fixtures.test-helpers';
import { countOpenFlags, createFollowup, listFlags, updateFlag } from './flags';
import { evaluateRules } from './rules';

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

const AFTER = new Date('2026-11-10T12:00:00Z');

/** A client with an open missed-workouts flag (sessions 11-04 and 11-06 missed). */
async function flagged(): Promise<{ w: ClientWorld; flagId: string }> {
  const w = await newClientWorld(prisma, await newOrg(prisma));
  await runAs(prisma, w.coach, (tx) => evaluateRules(tx, w.orgId, AFTER));
  const [flag] = await runAs(prisma, w.coach, (tx) => listFlags(tx, w.coach));
  return { w, flagId: flag!.id };
}

const act = (w: ClientWorld, id: string, input: Parameters<typeof updateFlag>[3], now = AFTER) =>
  runAs(prisma, w.coach, (tx) => updateFlag(tx, w.coach, id, input, { now }));

describe('review queue', () => {
  it('lists with the rule text, dates and link; counts per rule', async () => {
    const { w } = await flagged();
    const [flag] = await runAs(prisma, w.coach, (tx) => listFlags(tx, w.coach));
    expect(flag).toMatchObject({
      clientName: 'Client',
      ruleKey: 'missed_workouts',
      ruleText: 'Missed 2 or more workouts in the last 7 days',
      severity: 'needs_review',
      state: 'open',
      dates: ['2026-11-04', '2026-11-06'],
      href: `/app/clients/${w.clientId}/sessions`,
    });
    const counts = await runAs(prisma, w.coach, (tx) => countOpenFlags(tx, w.coach));
    expect(counts).toMatchObject({ total: 1, byRule: { missed_workouts: 1, checkin_new: 0 } });
    expect(
      await runAs(prisma, w.coach, (tx) => listFlags(tx, w.coach, { rule: 'checkin_new' })),
    ).toEqual([]);
  });

  it('resolve without a reason → 422; with one → closed, audited without the reason', async () => {
    const { w, flagId } = await flagged();
    const bad = await act(w, flagId, { action: 'resolve', reason: '  ' }).catch((e: unknown) => e);
    expect(bad).toMatchObject({ code: 'VALIDATION', fieldErrors: { reason: ['Add a reason.'] } });
    const done = await act(w, flagId, { action: 'resolve', reason: 'Called her, travel week' });
    expect(done).toMatchObject({ state: 'resolved', resolutionReason: 'Called her, travel week' });
    expect(await codeOf(act(w, flagId, { action: 'dismiss', reason: 'x' }))).toBe('CONFLICT');
    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: flagId } }),
      prisma,
    );
    expect(audits.map((a) => a.action)).toEqual(['review_flag.resolved']);
    expect(JSON.stringify(audits)).not.toContain('travel');
    expect(await runAs(prisma, w.coach, (tx) => listFlags(tx, w.coach))).toEqual([]);
    expect(
      (await runAs(prisma, w.coach, (tx) => listFlags(tx, w.coach, { filter: 'closed' })))[0]?.id,
    ).toBe(flagId);
  });

  it('snooze 1/3/7 days or a custom date; the sweep reopens it; reopen and dismiss', async () => {
    const { w, flagId } = await flagged();
    expect(await codeOf(act(w, flagId, { action: 'snooze', days: 2 }))).toBe('VALIDATION');
    expect(await codeOf(act(w, flagId, { action: 'snooze', until: '2026-11-10' }))).toBe(
      'VALIDATION',
    );
    // Not a calendar date: 422, not 500 (PR #2 review B M-3).
    for (const until of ['2026-02-31', '2026-13-01']) {
      expect(await codeOf(act(w, flagId, { action: 'snooze', until }))).toBe('VALIDATION');
    }
    const snoozed = await act(w, flagId, { action: 'snooze', days: 3 });
    expect(snoozed).toMatchObject({ state: 'snoozed', snoozedUntil: '2026-11-13T12:00:00.000Z' });
    const custom = await act(w, flagId, { action: 'snooze', until: '2026-11-20' });
    // 00:00 New York.
    expect(custom.snoozedUntil).toBe('2026-11-20T05:00:00.000Z');
    await runAs(prisma, w.coach, (tx) =>
      evaluateRules(tx, w.orgId, new Date('2026-11-20T05:00:01Z')),
    );
    const [back] = await runAs(prisma, w.coach, (tx) => listFlags(tx, w.coach));
    expect(back).toMatchObject({ id: flagId, state: 'open' });
    expect(back?.reopenedAt).not.toBeNull();
    await act(w, flagId, { action: 'dismiss', reason: 'Known' });
    expect((await act(w, flagId, { action: 'reopen' })).state).toBe('open');
  });

  it('follow-ups: created by the coach, listed, resolvable', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          createFollowup(tx, w.coach, { clientId: w.clientId, title: '' }),
        ),
      ),
    ).toBe('VALIDATION');
    const f = await runAs(prisma, w.coach, (tx) =>
      createFollowup(tx, w.coach, {
        clientId: w.clientId,
        title: 'Ask about the knee',
        dueLocalDate: '2026-11-12',
      }),
    );
    expect(f).toMatchObject({
      ruleKey: 'coach_followup',
      title: 'Ask about the knee',
      dates: ['2026-11-12'],
    });
    expect((await act(w, f.id, { action: 'resolve', reason: 'Asked' })).state).toBe('resolved');
  });

  it('other org → NOT_FOUND; clients → FORBIDDEN', async () => {
    const { w, flagId } = await flagged();
    const other = await newOrg(prisma);
    expect(
      await codeOf(
        runAs(prisma, other.coach, (tx) =>
          updateFlag(tx, other.coach, flagId, { action: 'reopen' }),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(await runAs(prisma, other.coach, (tx) => listFlags(tx, other.coach))).toEqual([]);
    expect(
      await codeOf(
        runAs(prisma, other.coach, (tx) =>
          createFollowup(tx, other.coach, { clientId: w.clientId, title: 'x' }),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(await codeOf(runAs(prisma, w.client, (tx) => listFlags(tx, w.client)))).toBe(
      'FORBIDDEN',
    );
  });
});
