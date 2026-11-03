import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { calendarFeed, rotateCalendarToken } from '../calendar/feed';
import { queueClientReminders } from '../notifications/reminders';
import { savePackage, updatePaymentSettings } from '../payments/catalog';
import { recordManualPayment } from '../payments/purchases';
import { newClientWorld, newOrg, runAs, type ClientWorld } from '../sessions/fixtures.test-helpers';
import {
  cancelBooking,
  createBooking,
  creditBalance,
  listBookings,
  listSlots,
  markBooking,
} from './bookings';
import { FakeCalendar, signCalendarState, verifyCalendarState } from './calendarSync';
import { disconnectCalendar, saveCalendarConnection } from './connections';
import { addTimeOff, saveSessionType, setAvailability } from './setup';
import { syncCalendars } from './sync';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

// Wednesday 4 Nov 2026, 10:00 in New York (EST, after the 1 Nov DST change).
const NOW = new Date('2026-11-04T15:00:00Z');
const H = 3_600_000;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

/** A coach in New York with Mon-Fri 09:00-12:00 hours, a 60-minute call (15 min buffer after, 12 h notice). */
async function setup(opts: { usesCredit?: boolean } = {}) {
  const w = await newClientWorld(prisma, await newOrg(prisma));
  await runAs(prisma, w.coach, (tx) =>
    setAvailability(tx, w.coach, {
      timezone: 'America/New_York',
      windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '12:00' })),
    }),
  );
  const type = await runAs(prisma, w.coach, (tx) =>
    saveSessionType(tx, w.coach, {
      title: 'Coaching call',
      kind: 'call',
      durationMin: 60,
      bufferAfterMin: 15,
      minNoticeHours: 12,
      maxDaysAhead: 14,
      cancelWindowHours: 24,
      callLink: 'https://meet.example.test/abc',
      usesCredit: opts.usesCredit === true,
    }),
  );
  return { w, type };
}

const slotsOn = async (w: ClientWorld, typeId: string, day: string, now = NOW) =>
  (
    await runAs(prisma, w.client, (tx) => listSlots(tx, w.client, { sessionTypeId: typeId }, now))
  ).slots.filter((s) => s.startsWith(day));

describe('session types and availability (K10, H15)', () => {
  it('accepts https call links only and validates the rest', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    for (const callLink of [
      'javascript:alert(1)',
      'http://meet.example.test/x',
      'https://u:p@x.test/',
      'nope',
    ]) {
      expect(
        await code(
          runAs(prisma, w.coach, (tx) =>
            saveSessionType(tx, w.coach, {
              title: 'Call',
              kind: 'call',
              durationMin: 30,
              callLink,
            }),
          ),
        ),
      ).toBe('VALIDATION');
    }
    expect(
      await code(
        runAs(prisma, w.coach, (tx) =>
          setAvailability(tx, w.coach, {
            timezone: 'America/New_York',
            windows: [
              { weekday: 1, start: '09:00', end: '12:00' },
              { weekday: 1, start: '11:00', end: '13:00' },
            ],
          }),
        ),
      ),
    ).toBe('VALIDATION');
    // A client can't set up a schedule.
    expect(
      await code(
        runAs(prisma, w.client, (tx) =>
          saveSessionType(tx, w.client, { title: 'X', kind: 'call', durationMin: 30 }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it('offers slots in the coach’s hours, DST-safe, after the notice, around buffers, time off and busy times', async () => {
    const { w, type } = await setup();
    // Thursday 5 Nov: 09:00, 09:30 … 11:00 New York = 14:00Z … 16:00Z.
    expect(await slotsOn(w, type.id, '2026-11-05')).toEqual([
      '2026-11-05T14:00:00.000Z',
      '2026-11-05T14:30:00.000Z',
      '2026-11-05T15:00:00.000Z',
      '2026-11-05T15:30:00.000Z',
      '2026-11-05T16:00:00.000Z',
    ]);
    // Today (Wednesday) is inside the 12-hour notice; weekends have no hours.
    expect(await slotsOn(w, type.id, '2026-11-04')).toEqual([]);
    expect(await slotsOn(w, type.id, '2026-11-07')).toEqual([]);
    // Across the DST change: Friday 30 Oct 09:00 is EDT (13:00Z), Monday 2 Nov 09:00 is EST (14:00Z).
    const early = new Date('2026-10-29T00:00:00Z');
    expect((await slotsOn(w, type.id, '2026-10-30', early))[0]).toBe('2026-10-30T13:00:00.000Z');
    expect((await slotsOn(w, type.id, '2026-11-02', early))[0]).toBe('2026-11-02T14:00:00.000Z');

    // A booking at 11:00 leaves 09:00 and 09:30; 10:00 would run (with its 15-minute buffer) into it.
    await runAs(prisma, w.client, (tx) =>
      createBooking(
        tx,
        w.client,
        { sessionTypeId: type.id, startsAt: '2026-11-05T16:00:00.000Z' },
        { now: NOW },
      ),
    );
    expect(await slotsOn(w, type.id, '2026-11-05')).toEqual([
      '2026-11-05T14:00:00.000Z',
      '2026-11-05T14:30:00.000Z',
    ]);

    // Time off on Friday morning and a busy hour on Monday from the coach's calendar.
    await runAs(prisma, w.coach, (tx) =>
      addTimeOff(tx, w.coach, {
        startsAt: '2026-11-06T13:00:00.000Z',
        endsAt: '2026-11-06T18:00:00.000Z',
      }),
    );
    expect(await slotsOn(w, type.id, '2026-11-06')).toEqual([]);
    await withSystem(
      (tx) =>
        tx.calendarBusy.create({
          data: {
            organizationId: w.orgId,
            userId: w.coach.userId,
            startsAt: new Date('2026-11-09T14:00:00Z'),
            endsAt: new Date('2026-11-09T15:00:00Z'),
          },
        }),
      prisma,
    );
    expect(await slotsOn(w, type.id, '2026-11-09')).toEqual([
      '2026-11-09T15:00:00.000Z',
      '2026-11-09T15:30:00.000Z',
      '2026-11-09T16:00:00.000Z',
    ]);
  });
});

describe('bookings (K10, D-013 #11)', () => {
  it('never double-books a coach, even when two clients race for the same slot', async () => {
    const { w, type } = await setup();
    const other = await newClientWorld(prisma, w);
    const slot = '2026-11-05T14:00:00.000Z';
    const results = await Promise.all(
      [w.client, other.client].map((c) =>
        code(
          runAs(prisma, c, (tx) =>
            createBooking(tx, c, { sessionTypeId: type.id, startsAt: slot }, { now: NOW }),
          ),
        ),
      ),
    );
    expect(results.sort()).toEqual(['CONFLICT', 'ok']);
    // An off-grid or closed time is refused too.
    expect(
      await code(
        runAs(prisma, w.client, (tx) =>
          createBooking(
            tx,
            w.client,
            { sessionTypeId: type.id, startsAt: '2026-11-07T15:00:00.000Z' },
            { now: NOW },
          ),
        ),
      ),
    ).toBe('CONFLICT');
  });

  it('a client books only with their own coach; another workspace sees nothing', async () => {
    const { w, type } = await setup();
    const elsewhere = await setup();
    expect(
      await code(
        runAs(prisma, w.client, (tx) =>
          listSlots(tx, w.client, { sessionTypeId: elsewhere.type.id }, NOW),
        ),
      ),
    ).toBe('NOT_FOUND');
    const b = await runAs(prisma, w.client, (tx) =>
      createBooking(
        tx,
        w.client,
        { sessionTypeId: type.id, startsAt: '2026-11-05T14:00:00.000Z' },
        { now: NOW },
      ),
    );
    expect(b).toMatchObject({
      title: 'Coaching call',
      callLink: 'https://meet.example.test/abc',
      status: 'booked',
    });
    expect(
      await runAs(prisma, elsewhere.w.coach, (tx) => listBookings(tx, elsewhere.w.coach, {}, NOW)),
    ).toEqual([]);
    expect(
      await code(
        runAs(prisma, elsewhere.w.coach, (tx) =>
          cancelBooking(tx, elsewhere.w.coach, b.id, { now: NOW }),
        ),
      ),
    ).toBe('NOT_FOUND');
  });

  it('a coach books and marks only their own sessions; a departed coach takes no bookings (review S1-S3)', async () => {
    const { w, type } = await setup();
    // A second coach in the same workspace.
    const other = await withSystem(async (tx) => {
      const u = await tx.user.create({
        data: { email: `c2-${Date.now()}@example.test`, name: 'Coach Two' },
      });
      await tx.membership.create({
        data: { userId: u.id, organizationId: w.orgId, role: 'coach' },
      });
      return u;
    }, prisma);
    const coach2 = {
      userId: other.id,
      orgId: w.orgId,
      role: 'coach' as const,
      isPlatformAdmin: false,
    };
    const slot = '2026-11-05T14:00:00.000Z';
    expect(
      await code(
        runAs(prisma, coach2, (tx) =>
          createBooking(
            tx,
            coach2,
            { sessionTypeId: type.id, startsAt: slot, clientId: w.clientId },
            { now: NOW },
          ),
        ),
      ),
    ).toBe('NOT_FOUND');
    const b = await runAs(prisma, w.client, (tx) =>
      createBooking(tx, w.client, { sessionTypeId: type.id, startsAt: slot }, { now: NOW }),
    );
    const after = new Date('2026-11-05T15:30:00Z');
    expect(
      await code(
        runAs(prisma, coach2, (tx) => markBooking(tx, coach2, b.id, 'no_show', { now: after })),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await code(runAs(prisma, coach2, (tx) => cancelBooking(tx, coach2, b.id, { now: NOW }))),
    ).toBe('FORBIDDEN');
    // The session type's coach leaves: nothing more can be booked with them.
    await withSystem(
      (tx) =>
        tx.membership.updateMany({
          where: { userId: w.coach.userId, organizationId: w.orgId },
          data: { status: 'inactive' },
        }),
      prisma,
    );
    expect(
      await code(
        runAs(prisma, w.client, (tx) =>
          createBooking(
            tx,
            w.client,
            { sessionTypeId: type.id, startsAt: '2026-11-06T14:00:00.000Z' },
            { now: NOW },
          ),
        ),
      ),
    ).toBe('NOT_FOUND');
  });

  it('session credits: none means no booking; cancelling in time returns one, late cancel is refused, no-show keeps it', async () => {
    const { w, type } = await setup({ usesCredit: true });
    const book = (startsAt: string, now = NOW) =>
      runAs(prisma, w.client, (tx) =>
        createBooking(tx, w.client, { sessionTypeId: type.id, startsAt }, { now }),
      );
    expect(await code(book('2026-11-05T14:00:00.000Z'))).toBe('CONFLICT');

    await runAs(prisma, w.coach, (tx) => updatePaymentSettings(tx, w.coach, { currency: 'USD' }));
    const pack = await runAs(prisma, w.coach, (tx) =>
      savePackage(tx, w.coach, {
        title: '2 sessions',
        kind: 'one_off',
        amountMinor: 10000,
        sessionCredits: 2,
        creditsValidDays: 60,
      }),
    );
    await runAs(prisma, w.coach, (tx) =>
      recordManualPayment(
        tx,
        w.coach,
        { clientId: w.clientId, packageId: pack.id, method: 'cash' },
        { now: NOW },
      ),
    );
    const balance = () =>
      runAs(prisma, w.client, (tx) => creditBalance(tx, w.client, undefined, NOW));
    expect(await balance()).toMatchObject({ left: 2 });

    const first = await book('2026-11-06T14:00:00.000Z');
    expect(first.usedCredit).toBe(true);
    expect(await balance()).toMatchObject({ left: 1 });
    // More than 24 hours ahead: the client may cancel, and the credit comes back.
    const canceled = await runAs(prisma, w.client, (tx) =>
      cancelBooking(tx, w.client, first.id, { now: NOW }),
    );
    expect(canceled).toMatchObject({ status: 'canceled', creditReturned: true });
    expect(await balance()).toMatchObject({ left: 2 });

    // Inside the window the client can't cancel here; the coach can, and the credit still comes back.
    const second = await book('2026-11-09T14:00:00.000Z');
    const late = new Date('2026-11-09T02:00:00Z');
    expect(
      await code(
        runAs(prisma, w.client, (tx) => cancelBooking(tx, w.client, second.id, { now: late })),
      ),
    ).toBe('CONFLICT');
    await runAs(prisma, w.coach, (tx) => cancelBooking(tx, w.coach, second.id, { now: late }));
    expect(await balance()).toMatchObject({ left: 2 });

    // A no-show keeps its credit used.
    const third = await book('2026-11-10T14:00:00.000Z');
    await runAs(prisma, w.coach, (tx) =>
      markBooking(tx, w.coach, third.id, 'no_show', { now: new Date('2026-11-10T15:30:00Z') }),
    );
    expect(await balance()).toMatchObject({ left: 1 });
  });

  it('reminds once within 24 hours under the workout opt-in, and joins the private calendar feed', async () => {
    const { w, type } = await setup();
    const b = await runAs(prisma, w.client, (tx) =>
      createBooking(
        tx,
        w.client,
        { sessionTypeId: type.id, startsAt: '2026-11-05T14:00:00.000Z' },
        { now: NOW },
      ),
    );
    await withSystem(
      (tx) =>
        tx.notificationPreference.upsert({
          where: { userId: w.userId },
          create: { userId: w.userId, workoutReminderOptIn: true },
          update: { workoutReminderOptIn: true },
        }),
      prisma,
    );
    // 08:00 New York on the day before: inside 24 hours, outside quiet hours.
    const morning = new Date('2026-11-04T18:00:00Z');
    await runAs(prisma, w.coach, (tx) => queueClientReminders(tx, morning));
    await runAs(prisma, w.coach, (tx) => queueClientReminders(tx, new Date(morning.getTime() + H)));
    const emails = await withSystem(
      (tx) =>
        tx.outboxEmail.findMany({
          where: { organizationId: w.orgId, templateKey: 'booking_reminder' },
        }),
      prisma,
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]?.payloadJson).toEqual({ bookingId: b.id });

    const { token } = await runAs(prisma, w.client, (tx) => rotateCalendarToken(tx, w.client));
    const ics = await calendarFeed(prisma, token, { now: NOW });
    expect(ics).toContain(`UID:booking-${b.id}@kinetic`);
    expect(ics).toContain('DTSTART:20261105T140000Z');
  });
});

describe('calendar sync (D-013 #11)', () => {
  it('pushes bookings, deletes cancelled ones, and hides busy times', async () => {
    const { w, type } = await setup();
    const fake = new FakeCalendar();
    const deps = {
      portFor: () => fake,
      open: (s: string) => JSON.parse(s) as never,
      seal: (t: unknown) => JSON.stringify(t),
      appBaseUrl: 'http://localhost:3000',
    };
    await runAs(prisma, w.coach, (tx) =>
      saveCalendarConnection(
        tx,
        w.coach,
        {
          provider: 'fake',
          accountEmail: 'c@example.test',
          tokenCiphertext: JSON.stringify({
            accessToken: 'a',
            refreshToken: 'r',
            expiresAt: NOW.getTime() + H,
          }),
        },
        { now: NOW },
      ),
    );
    fake.busyIntervals = [
      { start: new Date('2026-11-10T14:00:00Z'), end: new Date('2026-11-10T17:00:00Z') },
    ];
    const b = await runAs(prisma, w.client, (tx) =>
      createBooking(
        tx,
        w.client,
        { sessionTypeId: type.id, startsAt: '2026-11-06T14:00:00.000Z' },
        { now: NOW },
      ),
    );
    expect(await syncCalendars(prisma, deps, NOW)).toMatchObject({ pushed: 1, busyRefreshed: 1 });
    expect([...fake.events.values()].map((e) => e.title)).toEqual([
      expect.stringMatching(/^Coaching call: /),
    ]);
    expect(await slotsOn(w, type.id, '2026-11-10')).toEqual([]);

    await runAs(prisma, w.client, (tx) => cancelBooking(tx, w.client, b.id, { now: NOW }));
    expect(await syncCalendars(prisma, deps, NOW)).toMatchObject({ pushed: 1 });
    expect(fake.events.size).toBe(0);

    await runAs(prisma, w.coach, (tx) => disconnectCalendar(tx, w.coach));
    expect(await slotsOn(w, type.id, '2026-11-10')).toHaveLength(5);
  });

  it('signs OAuth state to the user, workspace and provider for 15 minutes', () => {
    const now = Date.now();
    const s = signCalendarState('k', 'u1', 'o1', 'google', now);
    expect(verifyCalendarState('k', s, 'u1', 'o1', 'google', now)).toBe(true);
    expect(verifyCalendarState('k', s, 'u1', 'o1', 'outlook', now)).toBe(false);
    expect(verifyCalendarState('k', s, 'u2', 'o1', 'google', now)).toBe(false);
    expect(verifyCalendarState('other', s, 'u1', 'o1', 'google', now)).toBe(false);
    expect(verifyCalendarState('k', s, 'u1', 'o1', 'google', now + 16 * 60_000)).toBe(false);
  });
});
