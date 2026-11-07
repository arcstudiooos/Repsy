import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import {
  listLocations,
  listStaffLocations,
  saveLocation,
  setClientLocation,
  setLocationArchived,
  setStaffLocation,
} from '../locations/locations';
import {
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import {
  cancelClass,
  cancelEnrollment,
  classRoster,
  createClassSeries,
  enrollInClass,
  listClasses,
  markAttendance,
  setClassCapacity,
} from './classes';

/** PRD A15 locations and K12 group classes against Postgres. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let w: ClientWorld;
let other: ClientWorld;
let secondClient: ActorContext;
let secondClientId: string;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  w = await newClientWorld(prisma, await newOrg(prisma));
  other = await newClientWorld(prisma, await newOrg(prisma));
  ({ clientId: secondClientId, client: secondClient } = await newClientWorld(prisma, {
    orgId: w.orgId,
    coach: w.coach,
  }));
});
afterAll(async () => {
  await drop();
});

const as = <T>(actor: ActorContext, fn: Parameters<typeof runAs<T>>[2]) => runAs(prisma, actor, fn);
const TUE = '2026-11-10T07:00:00.000Z';

describe('locations (A15)', () => {
  it('managers add, rename and archive locations; clients and staff are tied to one', async () => {
    const { id } = await as(w.coach, (tx) =>
      saveLocation(tx, w.coach, { name: 'Andheri', address: 'Mumbai' }),
    );
    await as(w.coach, (tx) => saveLocation(tx, w.coach, { id, name: 'Andheri West' }));
    await as(w.coach, (tx) => setClientLocation(tx, w.coach, w.clientId, id));
    await as(w.coach, (tx) => setStaffLocation(tx, w.coach, w.coach.userId, id));
    const [loc] = await as(w.coach, (tx) => listLocations(tx, w.coach));
    expect(loc).toMatchObject({ name: 'Andheri West', clientCount: 1, staffCount: 1 });
    expect(await as(w.coach, (tx) => listStaffLocations(tx, w.coach))).toMatchObject([
      { userId: w.coach.userId, locationId: id },
    ]);

    // Another workspace cannot see or use it.
    expect(await as(other.coach, (tx) => listLocations(tx, other.coach))).toEqual([]);
    await expect(
      as(other.coach, (tx) => setClientLocation(tx, other.coach, other.clientId, id)),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await as(w.coach, (tx) => setLocationArchived(tx, w.coach, id, true));
    expect(await as(w.coach, (tx) => listLocations(tx, w.coach))).toEqual([]);
    await expect(
      as(w.coach, (tx) => setClientLocation(tx, w.coach, w.clientId, id)),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('clients cannot manage locations', async () => {
    await expect(
      as(w.client, (tx) => saveLocation(tx, w.client, { name: 'Mine' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('group classes (K12)', () => {
  let classId: string;

  it('creates a weekly series', async () => {
    const res = await as(w.coach, (tx) =>
      createClassSeries(
        tx,
        w.coach,
        { title: 'HIIT', startsAt: TUE, durationMinutes: 45, capacity: 1, repeatWeeks: 3 },
        { now: NOW },
      ),
    );
    expect(res.created).toBe(3);
    const classes = await as(w.coach, (tx) =>
      listClasses(tx, w.coach, { from: NOW, to: new Date('2026-12-31T00:00:00Z') }),
    );
    expect(classes.map((c) => c.startsAt)).toEqual([
      TUE,
      '2026-11-17T07:00:00.000Z',
      '2026-11-24T07:00:00.000Z',
    ]);
    classId = classes[0]!.id;
  });

  it('books until full, then waitlists; a cancellation promotes the first in line', async () => {
    expect(
      await as(w.client, (tx) => enrollInClass(tx, w.client, { classId }, { now: NOW })),
    ).toEqual({
      status: 'booked',
    });
    expect(
      await as(secondClient, (tx) => enrollInClass(tx, secondClient, { classId }, { now: NOW })),
    ).toEqual({ status: 'waitlisted' });
    const mine = await as(secondClient, (tx) =>
      listClasses(tx, secondClient, { from: NOW, to: new Date('2026-11-11T00:00:00Z') }),
    );
    expect(mine[0]).toMatchObject({ booked: 1, waitlisted: 1, myStatus: 'waitlisted' });

    const res = await as(w.client, (tx) =>
      cancelEnrollment(tx, w.client, { classId }, { now: NOW }),
    );
    expect(res.promotedClientIds).toEqual([secondClientId]);
    expect(await as(w.coach, (tx) => classRoster(tx, w.coach, classId))).toMatchObject([
      { clientId: secondClientId, status: 'booked' },
    ]);

    // Rejoining goes to the back of the waitlist; raising capacity lets them in.
    expect(
      await as(w.client, (tx) => enrollInClass(tx, w.client, { classId }, { now: NOW })),
    ).toEqual({
      status: 'waitlisted',
    });
    expect(
      (await as(w.coach, (tx) => setClassCapacity(tx, w.coach, classId, 2))).promotedClientIds,
    ).toEqual([w.clientId]);
  });

  it('marks attendance only after the class starts, for booked clients', async () => {
    await expect(
      as(w.coach, (tx) =>
        markAttendance(tx, w.coach, classId, [{ clientId: w.clientId, attended: true }], {
          now: NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const after = new Date('2026-11-10T08:00:00Z');
    const res = await as(w.coach, (tx) =>
      markAttendance(
        tx,
        w.coach,
        classId,
        [
          { clientId: w.clientId, attended: true },
          { clientId: secondClientId, attended: false },
        ],
        { now: after },
      ),
    );
    expect(res.marked).toBe(2);
  });

  it('cancels the rest of a series, and clients stop seeing those classes', async () => {
    const classes = await as(w.coach, (tx) =>
      listClasses(tx, w.coach, { from: NOW, to: new Date('2026-12-31T00:00:00Z') }),
    );
    const res = await as(w.coach, (tx) =>
      cancelClass(tx, w.coach, classes[1]!.id, { wholeSeries: true, now: NOW }),
    );
    expect(res.cancelled).toBe(2);
    const visible = await as(w.client, (tx) =>
      listClasses(tx, w.client, { from: NOW, to: new Date('2026-12-31T00:00:00Z') }),
    );
    expect(visible).toHaveLength(1);
    await expect(
      as(w.client, (tx) => enrollInClass(tx, w.client, { classId: classes[1]!.id }, { now: NOW })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('another workspace cannot see or book these classes', async () => {
    expect(
      await as(other.coach, (tx) =>
        listClasses(tx, other.coach, { from: NOW, to: new Date('2026-12-31T00:00:00Z') }),
      ),
    ).toEqual([]);
    await expect(
      as(other.client, (tx) => enrollInClass(tx, other.client, { classId }, { now: NOW })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
