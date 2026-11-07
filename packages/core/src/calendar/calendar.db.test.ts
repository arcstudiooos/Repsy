import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import {
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { cancelBooking, createBooking, saveSessionType } from '../scheduling/scheduling';
import {
  disconnectCalendar,
  getCalendarConnection,
  saveGoogleConnection,
  signCalendarState,
  syncPendingBookings,
  verifyCalendarState,
} from './connections';
import { googleConsentUrl, type GoogleOAuthConfig } from './google';
import { decryptToken, encryptToken } from './tokenCrypto';

/** PRD K10: Google Calendar sync against Postgres, with Google faked at the fetch boundary. */
const env = { BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1' };
const config: GoogleOAuthConfig = {
  clientId: 'cid',
  clientSecret: 'csecret',
  redirectUri: 'http://localhost:3000/api/v1/calendar/google/callback',
};

let prisma: PrismaClient;
let drop: () => Promise<void>;
let w: ClientWorld;
let typeId: string;

/** Records Google calls; answers like the real API. */
function fakeGoogle(opts: { revoked?: boolean } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let next = 1;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' && init.body.startsWith('{')
        ? JSON.parse(init.body)
        : init?.body;
    calls.push({ method, url, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.includes('oauth2.googleapis.com/token')) {
      return opts.revoked
        ? json(400, { error: 'invalid_grant' })
        : json(200, { access_token: 'at' });
    }
    if (method === 'POST' && url.endsWith('/events')) return json(200, { id: `evt-${next++}` });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

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

describe('tokens and OAuth state', () => {
  it('encrypts refresh tokens and rejects tampering', () => {
    const sealed = encryptToken('refresh-123', env);
    expect(sealed).not.toContain('refresh-123');
    expect(decryptToken(sealed, env)).toBe('refresh-123');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('nope').toString('base64url');
    expect(() => decryptToken(parts.join('.'), env)).toThrow();
  });

  it('signs state bound to user and workspace, expiring after 10 minutes', () => {
    const state = signCalendarState({ userId: 'u1', orgId: 'o1' }, 's', NOW);
    expect(verifyCalendarState(state, 's', NOW)).toEqual({ userId: 'u1', orgId: 'o1' });
    expect(verifyCalendarState(state, 'other', NOW)).toBeNull();
    expect(verifyCalendarState(state, 's', new Date(NOW.getTime() + 11 * 60_000))).toBeNull();
    expect(googleConsentUrl(config, state)).toContain('access_type=offline');
  });
});

describe('two-way Google sync', () => {
  const THU_10 = '2026-11-05T15:00:00.000Z';
  const THU_11 = '2026-11-05T16:00:00.000Z';
  const book = (startsAt: string, externalBusy?: { startsAt: Date; endsAt: Date }[]) =>
    runAs(prisma, w.coach, (tx) =>
      createBooking(
        tx,
        w.coach,
        {
          sessionTypeId: typeId,
          clientId: w.clientId,
          startsAt,
          endsAt: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
        },
        { now: NOW, externalBusy },
      ),
    );

  it("rejects a slot that is busy in the coach's calendar", async () => {
    await expect(
      book(THU_10, [{ startsAt: new Date(THU_10), endsAt: new Date(THU_11) }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('pushes bookings once connected, and removes them when cancelled', async () => {
    const { id } = await book(THU_10);
    // No connection yet: the sweep marks it done without calling Google.
    const idle = fakeGoogle();
    await syncPendingBookings(prisma, config, { env, fetchImpl: idle.fetchImpl, now: NOW });
    expect(idle.calls).toHaveLength(0);

    await runAs(prisma, w.coach, (tx) =>
      saveGoogleConnection(
        tx,
        w.coach,
        { accountEmail: 'coach@gmail.test', refreshToken: 'rt' },
        env,
        NOW,
      ),
    );
    const g = fakeGoogle();
    const pushed = await syncPendingBookings(prisma, config, {
      env,
      fetchImpl: g.fetchImpl,
      now: NOW,
    });
    expect(pushed).toMatchObject({ pushed: 1, failed: 0 });
    const insert = g.calls.find((c) => c.method === 'POST' && c.url.endsWith('/events'));
    expect(insert?.body).toMatchObject({ summary: expect.stringContaining('PT with') });
    const row = await withSystem((tx) => tx.booking.findUniqueOrThrow({ where: { id } }), prisma);
    expect(row.externalEventId).toBe('evt-1');

    // A second sweep has nothing to do.
    const again = fakeGoogle();
    await syncPendingBookings(prisma, config, { env, fetchImpl: again.fetchImpl, now: NOW });
    expect(again.calls).toHaveLength(0);

    await runAs(prisma, w.coach, (tx) => cancelBooking(tx, w.coach, id, { now: NOW }));
    const del = fakeGoogle();
    expect(
      await syncPendingBookings(prisma, config, { env, fetchImpl: del.fetchImpl, now: NOW }),
    ).toMatchObject({
      removed: 1,
    });
    expect(del.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/events/evt-1'))).toBe(
      true,
    );
  });

  it('marks the connection broken when Google revokes access', async () => {
    await book(THU_11);
    const g = fakeGoogle({ revoked: true });
    await syncPendingBookings(prisma, config, { env, fetchImpl: g.fetchImpl, now: NOW });
    const view = await runAs(prisma, w.coach, (tx) => getCalendarConnection(tx, w.coach));
    expect(view).toMatchObject({ status: 'error', lastError: expect.stringContaining('revoked') });
  });

  it('disconnect removes the connection and hands back the token to revoke', async () => {
    const res = await runAs(prisma, w.coach, (tx) => disconnectCalendar(tx, w.coach, env));
    expect(res).toEqual({ refreshToken: 'rt' });
    expect(await runAs(prisma, w.coach, (tx) => getCalendarConnection(tx, w.coach))).toBeNull();
  });
});
