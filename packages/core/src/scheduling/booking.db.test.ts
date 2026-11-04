import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import {
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { purchasePack } from './packs';
import { createBooking, saveSessionType, withinAvailability } from './scheduling';

/**
 * PRD K10, K11 against Postgres: a booking must fall inside the coach's availability (in the workspace zone), and two
 * bookings racing for one coach or one pack never both win.
 */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let w: ClientWorld;
let typeId: string;

// NOW is Wednesday 2026-11-04 in New York. Availability: Thursdays 09:00-12:00 New York time (EST, UTC-5).
const THU_10 = '2026-11-05T15:00:00.000Z';
const THU_1030 = '2026-11-05T15:30:00.000Z';
const THU_11 = '2026-11-05T16:00:00.000Z';
const at = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000);

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  w = await newClientWorld(prisma, await newOrg(prisma));
  ({ id: typeId } = await runAs(prisma, w.coach, (tx) =>
    saveSessionType(tx, w.coach, {
      name: 'PT',
      kind: 'in_person',
      location: 'Studio',
      durationMinutes: 30,
      availability: [{ weekday: 4, startTime: '09:00', endTime: '12:00' }],
    }),
  ));
});
afterAll(async () => {
  await drop();
});

const book = (startsAt: string, extra: Record<string, unknown> = {}) =>
  runAs(prisma, w.client, (tx) =>
    createBooking(
      tx,
      w.client,
      {
        sessionTypeId: typeId,
        clientId: w.clientId,
        startsAt,
        endsAt: at(startsAt, 30).toISOString(),
        ...extra,
      },
      { now: NOW },
    ),
  );
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

describe('withinAvailability (K10)', () => {
  const windows = [{ weekday: 4, startTime: '09:00', endTime: '12:00' }];
  it('accepts a slot inside a window in the zone, and nothing outside it', () => {
    const ny = 'America/New_York';
    expect(withinAvailability(new Date(THU_10), at(THU_10, 30), windows, ny)).toBe(true);
    expect(
      withinAvailability(
        new Date('2026-11-05T16:30:00Z'),
        at('2026-11-05T16:30:00Z', 30),
        windows,
        ny,
      ),
    ).toBe(true); // 11:30-12:00 ends on the window edge
    expect(
      withinAvailability(
        new Date('2026-11-05T16:45:00Z'),
        at('2026-11-05T16:45:00Z', 30),
        windows,
        ny,
      ),
    ).toBe(false); // runs past 12:00
    expect(
      withinAvailability(
        new Date('2026-11-05T08:00:00Z'),
        at('2026-11-05T08:00:00Z', 30),
        windows,
        ny,
      ),
    ).toBe(false); // 03:00 local
    expect(
      withinAvailability(
        new Date('2026-11-06T15:00:00Z'),
        at('2026-11-06T15:00:00Z', 30),
        windows,
        ny,
      ),
    ).toBe(false); // a Friday
    expect(withinAvailability(new Date(THU_10), at(THU_10, 30), windows, 'Not/AZone')).toBe(false);
  });
});

describe('createBooking (K10, K11)', () => {
  it('refuses a time outside the availability', async () => {
    expect(await codeOf(book('2026-11-05T08:00:00.000Z'))).toBe('VALIDATION');
    expect(await codeOf(book('2026-11-06T15:00:00.000Z'))).toBe('VALIDATION');
  });

  it('lets only one of two overlapping bookings of one slot through', async () => {
    // Deterministic interleaving: A books and holds its transaction open; B books the same slot while A is still
    // uncommitted. Without a lock B cannot see A's row and both would win; with it B waits for A, then conflicts.
    const input = {
      sessionTypeId: typeId,
      clientId: w.clientId,
      startsAt: THU_10,
      endsAt: at(THU_10, 30).toISOString(),
    };
    let booked1!: () => void;
    const aBooked = new Promise<void>((resolve) => (booked1 = resolve));
    const a = codeOf(
      runAs(prisma, w.client, async (tx) => {
        await createBooking(tx, w.client, input, { now: NOW });
        booked1();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }),
    );
    await aBooked;
    const b = codeOf(
      runAs(prisma, w.client, (tx) => createBooking(tx, w.client, input, { now: NOW })),
    );
    expect([await a, await b]).toEqual(['ok', 'CONFLICT']);
    const booked = await withSystem(
      (tx) => tx.booking.count({ where: { clientId: w.clientId, status: 'booked' } }),
      prisma,
    );
    expect(booked).toBe(1);
  });

  it('spends the last pack credit once when two bookings race for it', async () => {
    const { id: packId } = await runAs(prisma, w.coach, (tx) =>
      purchasePack(
        tx,
        w.coach,
        { clientId: w.clientId, name: 'One', totalSessions: 1 },
        { now: NOW },
      ),
    );
    const results = await Promise.all([
      codeOf(book(THU_1030, { packId })),
      codeOf(book(THU_11, { packId })),
    ]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    const pack = await withSystem(
      (tx) => tx.sessionPack.findUniqueOrThrow({ where: { id: packId } }),
      prisma,
    );
    expect(pack.usedSessions).toBe(1);
  });
});
