import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { getMyThread, sendMessage } from '../messages/messages';
import {
  grid,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { getReviewRuleSettings, updateReviewRuleSettings } from './optInRules';
import { evaluateRules } from './rules';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

// NOW is Wednesday 2026-11-04 08:00 in New York: last full week is 26 Oct - 1 Nov, the one before 19-25 Oct.
const sweep = (w: ClientWorld, now = NOW) =>
  runAs(prisma, w.coach, (tx) => evaluateRules(tx, w.orgId, now));
const flags = (w: ClientWorld, ruleKey: string) =>
  withSystem(
    (tx) =>
      tx.reviewFlag.findMany({
        where: { clientId: w.clientId, ruleKey: ruleKey as never },
        orderBy: { createdAt: 'asc' },
      }),
    prisma,
  );
const enable = (w: ClientWorld, enabled: string[], weightChangeBandPct?: number) =>
  runAs(prisma, w.coach, (tx) =>
    updateReviewRuleSettings(tx, w.coach, { enabled, weightChangeBandPct }),
  );
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('opt-in review rules (PRD I3)', () => {
  it('program ending: flags the last week, only when on, and resolves once more is planned', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma)); // sessions 4, 6 and 9 Nov
    await sweep(w);
    expect(await flags(w, 'program_ending')).toHaveLength(0);
    await enable(w, ['program_ending']);
    await sweep(w);
    const [f] = await flags(w, 'program_ending');
    expect(f).toMatchObject({ state: 'open', sourceId: w.assignmentId });
    expect(f!.evidenceJson).toMatchObject({ dueLocalDate: '2026-11-09' });
    await sweep(w);
    expect(await flags(w, 'program_ending')).toHaveLength(1);

    // A longer program is not ending.
    const long = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(3, 3) });
    await enable(long, ['program_ending']);
    await sweep(long);
    expect(await flags(long, 'program_ending')).toHaveLength(0);

    // Planning more (here: moving the last workout three weeks out) resolves it.
    await withSystem(
      (tx) =>
        tx.workoutSession.updateMany({
          where: { assignmentId: w.assignmentId, scheduledLocalDate: d('2026-11-09') },
          data: { scheduledLocalDate: d('2026-11-30') },
        }),
      prisma,
    );
    await sweep(w);
    expect((await flags(w, 'program_ending'))[0]).toMatchObject({ state: 'resolved' });
  });

  it('habit low: under half of its days in each of the last two full weeks', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await enable(w, ['habit_low']);
    const habit = (title: string, days: string[]) =>
      withSystem(async (tx) => {
        const h = await tx.habit.create({
          data: {
            organizationId: w.orgId,
            clientId: w.clientId,
            title,
            daysPerWeek: 4,
            startDate: d('2026-10-12'),
            createdByUserId: w.coach.userId,
          },
        });
        for (const day of days) {
          await tx.habitLog.create({
            data: {
              organizationId: w.orgId,
              clientId: w.clientId,
              habitId: h.id,
              localDate: d(day),
            },
          });
        }
        return h.id;
      }, prisma);
    const low = await habit('Walk', ['2026-10-20', '2026-10-27']); // 1 of 4, then 1 of 4
    await habit('Stretch', ['2026-10-20', '2026-10-27', '2026-10-28']); // 1 of 4, then 2 of 4
    await sweep(w);
    const found = await flags(w, 'habit_low');
    expect(found.map((f) => f.sourceId)).toEqual([low]);
    expect(found[0]!.evidenceJson).toMatchObject({ dates: ['2026-10-19', '2026-10-26'] });
  });

  it('reply overdue: past the usual reply time; reading it resolves the flag', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await withSystem(
      (tx) => tx.organization.update({ where: { id: w.orgId }, data: { replyTargetHours: 4 } }),
      prisma,
    );
    await enable(w, ['reply_overdue']);
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    const msg = await runAs(prisma, w.client, (tx) =>
      sendMessage(tx, w.client, thread.id, { body: 'Is Friday still on?' }, { now: NOW }),
    );
    await sweep(w, new Date(NOW.getTime() + 3 * 3_600_000));
    expect(await flags(w, 'reply_overdue')).toHaveLength(0);
    await sweep(w, new Date(NOW.getTime() + 5 * 3_600_000));
    expect(await flags(w, 'reply_overdue')).toMatchObject([{ state: 'open', sourceId: msg.id }]);
    await withSystem(
      (tx) => tx.message.update({ where: { id: msg.id }, data: { readAt: new Date() } }),
      prisma,
    );
    await sweep(w, new Date(NOW.getTime() + 6 * 3_600_000));
    expect((await flags(w, 'reply_overdue'))[0]).toMatchObject({ state: 'resolved' });
  });

  it('weight change: beyond the band over 5-14 days', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await enable(w, ['weight_change'], 3);
    const weigh = (day: string, value: number) =>
      withSystem(
        (tx) =>
          tx.metricEntry.create({
            data: {
              organizationId: w.orgId,
              clientId: w.clientId,
              metric: 'weight',
              measuredOn: d(day),
              value,
              source: 'coach',
              recordedByUserId: w.coach.userId,
            },
          }),
        prisma,
      );
    await weigh('2026-10-25', 80);
    await weigh('2026-11-01', 78);
    await sweep(w);
    expect(await flags(w, 'weight_change')).toHaveLength(0); // -2.5%
    const latest = await weigh('2026-11-03', 77);
    await sweep(w);
    const [f] = await flags(w, 'weight_change');
    expect(f).toMatchObject({ sourceId: latest.id });
    expect(f!.evidenceJson).toMatchObject({ dates: ['2026-10-25', '2026-11-03'], changePct: -3.8 });
  });

  it('settings: owner only, known rules, and the weight rule needs a band', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    expect(await runAs(prisma, w.coach, (tx) => getReviewRuleSettings(tx, w.coach))).toEqual({
      enabled: [],
      clientsCanMoveWorkouts: false,
      weightChangeBandPct: null,
      replyTargetHours: null,
    });
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
    expect(await code(enable(w, ['nope']))).toBe('VALIDATION');
    expect(await code(enable(w, ['weight_change']))).toBe('VALIDATION');
    expect(await code(enable(w, ['weight_change'], 25))).toBe('VALIDATION');
    expect(
      await code(
        runAs(prisma, w.client, (tx) => updateReviewRuleSettings(tx, w.client, { enabled: [] })),
      ),
    ).toBe('FORBIDDEN');
    expect(await enable(w, ['weight_change', 'habit_low'], 5)).toMatchObject({
      enabled: ['habit_low', 'weight_change'],
      weightChangeBandPct: 5,
    });
  });
});
