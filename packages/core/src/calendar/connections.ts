import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { withSystem, type PrismaClient, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { removeBookingFromCalendar, syncBookingToCalendar } from '../scheduling/calendarSync';
import {
  GoogleCalendarError,
  GoogleCalendarSync,
  refreshGoogleAccessToken,
  type GoogleOAuthConfig,
} from './google';
import { decryptToken, encryptToken } from './tokenCrypto';

/**
 * PRD K10: each staff user connects their own Google calendar. Bookings they coach are pushed to it
 * by the worker (`syncPendingBookings`), and its busy times block new bookings (`coachBusyTimes`).
 */

export interface CalendarConnectionView {
  provider: 'google';
  accountEmail: string;
  status: 'active' | 'error';
  lastSyncedAt: string | null;
  lastError: string | null;
}

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

/* ----------------------------------------------------------------- OAuth state */

const STATE_TTL_MS = 10 * 60_000;

/** Signed, short-lived OAuth `state`: binds the Google callback to the user and workspace that began it. */
export function signCalendarState(
  input: { userId: string; orgId: string },
  secret: string,
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      u: input.userId,
      o: input.orgId,
      e: now.getTime() + STATE_TTL_MS,
      n: randomBytes(8).toString('hex'),
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyCalendarState(
  state: string,
  secret: string,
  now: Date = new Date(),
): { userId: string; orgId: string } | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u?: unknown;
      o?: unknown;
      e?: unknown;
    };
    if (typeof data.u !== 'string' || typeof data.o !== 'string' || typeof data.e !== 'number') {
      return null;
    }
    if (data.e < now.getTime()) return null;
    return { userId: data.u, orgId: data.o };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ tenant functions */

const toView = (row: {
  accountEmail: string;
  status: string;
  lastSyncedAt: Date | null;
  lastError: string | null;
}): CalendarConnectionView => ({
  provider: 'google',
  accountEmail: row.accountEmail,
  status: row.status === 'error' ? 'error' : 'active',
  lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  lastError: row.lastError,
});

/** The actor's own Google calendar connection, or null. */
export async function getCalendarConnection(
  tx: TenantTx,
  actor: ActorContext,
): Promise<CalendarConnectionView | null> {
  assertCan(actor, 'scheduling:manage');
  const row = await tx.calendarConnection.findFirst({
    where: { organizationId: actor.orgId, userId: actor.userId, provider: 'google' },
  });
  return row ? toView(row) : null;
}

/**
 * Stores (or replaces) the actor's Google connection after a successful OAuth callback, then marks
 * their upcoming bookings for a fresh push so the calendar catches up.
 */
export async function saveGoogleConnection(
  tx: TenantTx,
  actor: ActorContext,
  input: { accountEmail: string; refreshToken: string },
  env: Env = process.env,
  now: Date = new Date(),
): Promise<CalendarConnectionView> {
  assertCan(actor, 'scheduling:manage');
  const refreshTokenEnc = encryptToken(input.refreshToken, env);
  const row = await tx.calendarConnection.upsert({
    where: {
      organizationId_userId_provider: {
        organizationId: actor.orgId,
        userId: actor.userId,
        provider: 'google',
      },
    },
    create: {
      organizationId: actor.orgId,
      userId: actor.userId,
      provider: 'google',
      accountEmail: input.accountEmail,
      refreshTokenEnc,
    },
    update: {
      accountEmail: input.accountEmail,
      refreshTokenEnc,
      status: 'active',
      lastError: null,
    },
  });
  await tx.booking.updateMany({
    where: {
      organizationId: actor.orgId,
      cancelledAt: null,
      externalEventId: null,
      startsAt: { gt: now },
      OR: [
        { coachUserId: actor.userId },
        { coachUserId: null, sessionType: { coachUserId: actor.userId } },
      ],
    },
    data: { calendarSyncedAt: null, calendarError: null },
  });
  return toView(row);
}

/**
 * Removes the actor's connection and returns the decrypted refresh token so the caller can revoke it
 * at Google. Events already in the calendar stay there.
 */
export async function disconnectCalendar(
  tx: TenantTx,
  actor: ActorContext,
  env: Env = process.env,
): Promise<{ refreshToken: string | null }> {
  assertCan(actor, 'scheduling:manage');
  const row = await tx.calendarConnection.findFirst({
    where: { organizationId: actor.orgId, userId: actor.userId, provider: 'google' },
    select: { id: true, refreshTokenEnc: true },
  });
  if (!row) throw new DomainError('NOT_FOUND', 'No calendar is connected.');
  await tx.calendarConnection.delete({ where: { id: row.id } });
  await tx.booking.updateMany({
    where: { organizationId: actor.orgId, coachUserId: actor.userId },
    data: { externalEventId: null },
  });
  let refreshToken: string | null = null;
  try {
    refreshToken = decryptToken(row.refreshTokenEnc, env);
  } catch {
    refreshToken = null;
  }
  return { refreshToken };
}

/** The connected calendar of the coach who runs a session type (or the workspace owner), if any. */
export async function coachConnectionForSessionType(
  tx: TenantTx,
  sessionTypeId: string,
): Promise<{ refreshTokenEnc: string; calendarId: string } | null> {
  const type = await tx.sessionType.findFirst({
    where: { id: sessionTypeId },
    select: { coachUserId: true, organization: { select: { ownerUserId: true } } },
  });
  if (!type) return null;
  const coachId = type.coachUserId ?? type.organization.ownerUserId;
  return tx.calendarConnection.findFirst({
    where: { userId: coachId, provider: 'google', status: 'active' },
    select: { refreshTokenEnc: true, calendarId: true },
  });
}

/** Google busy blocks for a connection in [from, to). */
export async function coachBusyTimes(
  config: GoogleOAuthConfig,
  connection: { refreshTokenEnc: string; calendarId: string },
  from: Date,
  to: Date,
  deps: { env?: Env; fetchImpl?: Fetch } = {},
): Promise<{ startsAt: Date; endsAt: Date }[]> {
  const refresh = decryptToken(connection.refreshTokenEnc, deps.env ?? process.env);
  const access = await refreshGoogleAccessToken(config, refresh, deps.fetchImpl);
  return new GoogleCalendarSync(access, connection.calendarId, deps.fetchImpl).busy(from, to);
}

/* ------------------------------------------------------------------ worker sweep */

const short = (err: unknown) =>
  (err instanceof Error ? err.message : 'Calendar sync failed.').slice(0, 300);

/**
 * Worker: pushes new bookings to their coach's Google calendar and removes cancelled ones. Runs in
 * system scope across workspaces. A booking whose coach has no connection is marked synced, so the
 * sweep does not revisit it (connecting later re-marks upcoming bookings).
 */
export async function syncPendingBookings(
  prisma: PrismaClient,
  config: GoogleOAuthConfig,
  deps: { env?: Env; fetchImpl?: Fetch; now?: Date; limit?: number } = {},
): Promise<{ pushed: number; removed: number; failed: number }> {
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const stats = { pushed: 0, removed: 0, failed: 0 };

  const bookings = await withSystem(
    (tx) =>
      tx.booking.findMany({
        where: {
          endsAt: { gt: new Date(now.getTime() - 86_400_000) },
          OR: [
            { cancelledAt: null, calendarSyncedAt: null },
            { cancelledAt: { not: null }, externalEventId: { not: null } },
          ],
        },
        orderBy: { startsAt: 'asc' },
        take: deps.limit ?? 100,
        select: {
          id: true,
          organizationId: true,
          coachUserId: true,
          startsAt: true,
          endsAt: true,
          callLink: true,
          cancelledAt: true,
          externalEventId: true,
          client: { select: { name: true } },
          sessionType: { select: { name: true, coachUserId: true } },
          organization: { select: { timezone: true, ownerUserId: true } },
        },
      }),
    prisma,
  );
  if (bookings.length === 0) return stats;

  const coachOf = (b: (typeof bookings)[number]) =>
    b.coachUserId ?? b.sessionType.coachUserId ?? b.organization.ownerUserId;
  const groups = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const key = `${b.organizationId}:${coachOf(b)}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }

  for (const [key, group] of groups) {
    const [orgId, userId] = key.split(':') as [string, string];
    const connection = await withSystem(
      (tx) =>
        tx.calendarConnection.findFirst({
          where: { organizationId: orgId, userId, provider: 'google', status: 'active' },
        }),
      prisma,
    );
    if (!connection) {
      await withSystem(
        (tx) =>
          tx.booking.updateMany({
            where: { id: { in: group.filter((b) => !b.cancelledAt).map((b) => b.id) } },
            data: { calendarSyncedAt: now },
          }),
        prisma,
      );
      continue;
    }

    let port: GoogleCalendarSync;
    try {
      const access = await refreshGoogleAccessToken(
        config,
        decryptToken(connection.refreshTokenEnc, env),
        deps.fetchImpl,
      );
      port = new GoogleCalendarSync(access, connection.calendarId, deps.fetchImpl);
    } catch (err) {
      const revoked = err instanceof GoogleCalendarError && err.revoked;
      await withSystem(
        (tx) =>
          tx.calendarConnection.update({
            where: { id: connection.id },
            data: { lastError: short(err), ...(revoked ? { status: 'error' } : {}) },
          }),
        prisma,
      );
      stats.failed += group.length;
      continue;
    }

    for (const b of group) {
      try {
        if (b.cancelledAt) {
          await removeBookingFromCalendar(port, b.externalEventId);
          await withSystem(
            (tx) =>
              tx.booking.update({
                where: { id: b.id },
                data: { externalEventId: null, calendarSyncedAt: now, calendarError: null },
              }),
            prisma,
          );
          stats.removed += 1;
        } else {
          const externalId = await syncBookingToCalendar(
            port,
            {
              id: b.id,
              sessionTypeName: b.sessionType.name,
              clientName: b.client.name,
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              timeZone: b.organization.timezone,
              callLink: b.callLink,
              externalCalendarId: b.externalEventId,
            },
            () => undefined,
          );
          await withSystem(
            (tx) =>
              tx.booking.update({
                where: { id: b.id },
                data: { externalEventId: externalId, calendarSyncedAt: now, calendarError: null },
              }),
            prisma,
          );
          stats.pushed += 1;
        }
      } catch (err) {
        stats.failed += 1;
        await withSystem(
          (tx) => tx.booking.update({ where: { id: b.id }, data: { calendarError: short(err) } }),
          prisma,
        );
      }
    }
    await withSystem(
      (tx) =>
        tx.calendarConnection.update({
          where: { id: connection.id },
          data: { lastSyncedAt: now, ...(stats.failed === 0 ? { lastError: null } : {}) },
        }),
      prisma,
    );
  }
  return stats;
}
