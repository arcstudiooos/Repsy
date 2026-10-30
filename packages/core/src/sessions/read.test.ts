import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { assignProgram } from '../assignments/assign';
import { DomainError } from '../errors';
import { grid, newClientWorld, newOrg, NOW, runAs, sessionsOf } from './fixtures.test-helpers';
import { getPortalHome, isoWeekOf, listSessions } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

const setState = (id: string, data: Record<string, unknown>) =>
  withSystem((tx) => tx.workoutSession.update({ where: { id }, data }), prisma);

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('listSessions', () => {
  it('hides cancelled sessions and keeps an ended assignment’s earlier scheduled ones (D-010 #2)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    // Old: Mon/Wed/Fri from Wed 11-04 → 11-04, 11-06, 11-09. Replacement from 11-09 cancels 11-09 only.
    await runAs(prisma, w.coach, (tx) =>
      assignProgram(
        tx,
        w.coach,
        {
          clientId: w.clientId,
          templateProgramId: w.templateId,
          startLocalDate: '2026-11-09',
          weekdays: [1, 3, 5],
          readinessConfirmed: false,
          confirmReplace: true,
        },
        { now: NOW },
      ),
    );
    const { items } = await runAs(prisma, w.client, (tx) =>
      listSessions(tx, w.client, { scope: 'upcoming' }, { now: NOW }),
    );
    expect(items.map((s) => s.scheduledLocalDate)).toEqual([
      '2026-11-04',
      '2026-11-06',
      '2026-11-09',
      '2026-11-11',
      '2026-11-13',
    ]);
    expect(items.every((s) => s.state === 'scheduled')).toBe(true);
    expect(items[0]).toMatchObject({ title: 'W1D1', exerciseCount: 2, overdue: false });
    const past = await runAs(prisma, w.client, (tx) =>
      listSessions(tx, w.client, { scope: 'past' }, { now: NOW }),
    );
    expect(past.items).toEqual([]);
  });

  it('a client actor only sees own sessions; a clientId input is ignored', async () => {
    const org = await newOrg(prisma);
    const me = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, org);
    const { items } = await runAs(prisma, me.client, (tx) =>
      listSessions(tx, me.client, { scope: 'upcoming', clientId: other.clientId }),
    );
    expect(items.length).toBe(3);
    expect(new Set(items.map((s) => s.clientId))).toEqual(new Set([me.clientId]));
    // A client actor with no client record sees nothing.
    const orphan = { ...me.client, clientId: undefined };
    expect(
      await codeOf(runAs(prisma, orphan, (tx) => listSessions(tx, orphan, { scope: 'upcoming' }))),
    ).toBe('NOT_FOUND');
  });

  it("a coach must name a client of their org; another org's client is NOT_FOUND", async () => {
    const a = await newClientWorld(prisma, await newOrg(prisma));
    const b = await newClientWorld(prisma, await newOrg(prisma));
    expect(
      await codeOf(runAs(prisma, a.coach, (tx) => listSessions(tx, a.coach, { scope: 'past' }))),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(
        runAs(prisma, a.coach, (tx) =>
          listSessions(tx, a.coach, { scope: 'upcoming', clientId: b.clientId }),
        ),
      ),
    ).toBe('NOT_FOUND');
    const own = await runAs(prisma, a.coach, (tx) =>
      listSessions(tx, a.coach, { scope: 'upcoming', clientId: a.clientId }),
    );
    expect(own.items.length).toBe(3);
  });

  it('upcoming ascending, past descending; 30 sessions page as 25 + 5 without duplicates', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(10, 3) });
    const all: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await runAs(prisma, w.client, (tx) =>
        listSessions(tx, w.client, { scope: 'upcoming', cursor }),
      );
      all.push(...page.items.map((s) => s.scheduledLocalDate));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(2);
    expect(all.length).toBe(30);
    expect([...all].sort()).toEqual(all);

    for (const s of await sessionsOf(prisma, w.assignmentId)) {
      await setState(s.id, { state: 'completed', completedAt: NOW });
    }
    const first = await runAs(prisma, w.client, (tx) =>
      listSessions(tx, w.client, { scope: 'past' }),
    );
    expect(first.items.length).toBe(25);
    const second = await runAs(prisma, w.client, (tx) =>
      listSessions(tx, w.client, { scope: 'past', cursor: first.nextCursor ?? undefined }),
    );
    expect(second.items.length).toBe(5);
    expect(second.nextCursor).toBeNull();
    const past = [...first.items, ...second.items].map((s) => s.scheduledLocalDate);
    expect(new Set(past).size).toBe(30);
    expect([...past].sort().reverse()).toEqual(past);
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          listSessions(tx, w.client, { scope: 'past', cursor: 'garbage' }),
        ),
      ),
    ).toBe('VALIDATION');
  });

  it('marks open sessions past their due time as overdue', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const later = new Date('2026-11-07T15:00:00Z');
    const { items } = await runAs(prisma, w.client, (tx) =>
      listSessions(tx, w.client, { scope: 'upcoming' }, { now: later }),
    );
    expect(items.map((s) => s.overdue)).toEqual([true, true, false]);
  });
});

describe('getPortalHome', () => {
  it('next workout, this week n of m in the client time zone, safety reminder until the first start', async () => {
    // Mon/Wed/Fri from Wed 11-04 for 2 weeks: this week (Mon 11-02 .. Sun 11-08) holds 11-04 and 11-06.
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: grid(2, 3) });
    const home = await runAs(prisma, w.client, (tx) => getPortalHome(tx, w.client, { now: NOW }));
    expect(home).toMatchObject({
      nextWorkout: { scheduledLocalDate: '2026-11-04', state: 'scheduled', title: 'W1D1' },
      week: { completed: 0, total: 2, startLocalDate: '2026-11-02', endLocalDate: '2026-11-08' },
      showSafetyReminder: true,
      hasAssignment: true,
    });

    const [d1, d2] = await sessionsOf(prisma, w.assignmentId);
    await setState(d1!.id, { state: 'completed', completedAt: NOW, startedAt: NOW });
    await setState(d2!.id, { state: 'in_progress', startedAt: NOW });
    // Sunday 22:00 in New York is already Monday in UTC: the week is still the client's.
    const sundayNight = new Date('2026-11-09T03:00:00Z');
    const after = await runAs(prisma, w.client, (tx) =>
      getPortalHome(tx, w.client, { now: sundayNight }),
    );
    expect(after).toMatchObject({
      // The started session wins even though it is overdue.
      nextWorkout: { id: d2!.id, state: 'in_progress', overdue: true },
      week: { completed: 1, total: 2, startLocalDate: '2026-11-02' },
      showSafetyReminder: false,
    });
  });

  it('empty when the client has no assignment; coaches are refused', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const lonely = await withSystem(async (tx) => {
      const user = await tx.user.create({ data: { email: 'lonely@example.test', name: 'L' } });
      return tx.client.create({
        data: {
          organizationId: org.orgId,
          userId: user.id,
          coachUserId: org.coach.userId,
          name: 'L',
          email: 'lonely@example.test',
          status: 'active',
          timezone: 'UTC',
        },
      });
    }, prisma);
    const actor = { ...w.client, userId: lonely.userId!, clientId: lonely.id };
    const home = await runAs(prisma, actor, (tx) => getPortalHome(tx, actor, { now: NOW }));
    expect(home).toEqual({
      nextWorkout: null,
      week: { completed: 0, total: 0, startLocalDate: '2026-11-02', endLocalDate: '2026-11-08' },
      showSafetyReminder: true,
      hasAssignment: false,
      todayLocalDate: '2026-11-04',
    });
    expect(await codeOf(runAs(prisma, w.coach, (tx) => getPortalHome(tx, w.coach)))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('isoWeekOf', () => {
  it('maps any day to its Monday..Sunday', () => {
    expect(isoWeekOf('2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(isoWeekOf('2026-11-02')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(isoWeekOf('2026-12-31')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });
});
