import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import {
  CalendarAuthError,
  type CalendarProvider,
  type CalendarSyncPort,
  type CalendarTokens,
} from './calendarSync';

/**
 * Worker side of calendar sync (D-013 #11): pushes booked and cancelled sessions to the coach's connected calendar,
 * and refreshes the cache of busy intervals the slot finder reads. Each workspace's rows are handled in its own
 * tenant scope. A refused token marks the connection `error` (the coach reconnects); other failures retry up to five
 * times.
 */
export interface CalendarDeps {
  portFor(provider: CalendarProvider): CalendarSyncPort | null;
  open(sealed: string, context: string): CalendarTokens;
  seal(tokens: CalendarTokens, context: string): string;
  appBaseUrl: string;
}

export const sealContext = (orgId: string, userId: string) => `calendar:${orgId}:${userId}`;
const MAX_ATTEMPTS = 5;
const BUSY_EVERY_MS = 15 * 60_000;
const BUSY_AHEAD_MS = 62 * 86_400_000;

type Conn = {
  id: string;
  organizationId: string;
  userId: string;
  provider: string;
  tokenCiphertext: string;
  calendarId: string;
};

/** Opens a connection's tokens, refreshing and re-sealing them when they were about to expire. */
async function tokensFor(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  conn: Conn,
  port: CalendarSyncPort,
  deps: CalendarDeps,
  now: Date,
): Promise<CalendarTokens> {
  const ctx = sealContext(conn.organizationId, conn.userId);
  const current = deps.open(conn.tokenCiphertext, ctx);
  const next = await port.fresh(current, now);
  if (next !== current) {
    await tx.calendarConnection.updateMany({
      where: { id: conn.id },
      data: { tokenCiphertext: deps.seal(next, ctx) },
    });
  }
  return next;
}

export async function syncCalendars(
  prisma: PrismaClient,
  deps: CalendarDeps,
  now: Date = new Date(),
): Promise<{ pushed: number; failed: number; busyRefreshed: number }> {
  const result = { pushed: 0, failed: 0, busyRefreshed: 0 };
  const pending = await withSystem(
    (tx) =>
      tx.booking.findMany({
        where: { syncState: 'pending', syncAttempts: { lt: MAX_ATTEMPTS } },
        orderBy: { updatedAt: 'asc' },
        take: 50,
        select: { id: true, organizationId: true },
      }),
    prisma,
  );
  for (const b of pending) {
    await withTenant(
      b.organizationId,
      async (tx) => {
        const booking = await tx.booking.findFirst({
          where: { id: b.id, syncState: 'pending' },
          select: {
            id: true,
            coachUserId: true,
            status: true,
            title: true,
            startsAt: true,
            endsAt: true,
            callLink: true,
            location: true,
            calendarEventRef: true,
            syncAttempts: true,
            client: { select: { name: true } },
          },
        });
        if (!booking) return;
        const conn = await tx.calendarConnection.findFirst({
          where: { userId: booking.coachUserId, status: 'active' },
        });
        const port = conn ? deps.portFor(conn.provider as CalendarProvider) : null;
        if (!conn || !port) {
          await tx.booking.updateMany({ where: { id: b.id }, data: { syncState: 'none' } });
          return;
        }
        try {
          const tokens = await tokensFor(tx, conn, port, deps, now);
          if (booking.status === 'booked') {
            const ref = await port.upsertEvent(tokens, conn.calendarId, booking.calendarEventRef, {
              title: `${booking.title}: ${booking.client.name}`,
              start: booking.startsAt,
              end: booking.endsAt,
              description: [
                booking.callLink ?? booking.location ?? '',
                `Booked in Repsy: ${deps.appBaseUrl.replace(/\/+$/, '')}/app/schedule`,
              ]
                .filter(Boolean)
                .join('\n'),
            });
            await tx.booking.updateMany({
              where: { id: b.id },
              data: { calendarEventRef: ref, syncState: 'synced' },
            });
          } else {
            if (booking.calendarEventRef) {
              await port.deleteEvent(tokens, conn.calendarId, booking.calendarEventRef);
            }
            await tx.booking.updateMany({
              where: { id: b.id },
              data: { calendarEventRef: null, syncState: 'synced' },
            });
          }
          result.pushed++;
        } catch (e) {
          result.failed++;
          if (e instanceof CalendarAuthError) {
            await tx.calendarConnection.updateMany({
              where: { id: conn.id },
              data: { status: 'error' },
            });
          }
          const attempts = booking.syncAttempts + 1;
          await tx.booking.updateMany({
            where: { id: b.id },
            data: {
              syncAttempts: attempts,
              ...(attempts >= MAX_ATTEMPTS || e instanceof CalendarAuthError
                ? { syncState: 'failed' }
                : {}),
            },
          });
        }
      },
      prisma,
    );
  }

  const stale = await withSystem(
    (tx) =>
      tx.calendarConnection.findMany({
        where: {
          status: 'active',
          OR: [
            { busySyncedAt: null },
            { busySyncedAt: { lt: new Date(now.getTime() - BUSY_EVERY_MS) } },
          ],
        },
        take: 50,
        select: {
          id: true,
          organizationId: true,
          userId: true,
          provider: true,
          tokenCiphertext: true,
          calendarId: true,
        },
      }),
    prisma,
  );
  for (const conn of stale) {
    const port = deps.portFor(conn.provider as CalendarProvider);
    if (!port) continue;
    await withTenant(
      conn.organizationId,
      async (tx) => {
        try {
          const tokens = await tokensFor(tx, conn, port, deps, now);
          const busy = await port.busy(
            tokens,
            conn.calendarId,
            now,
            new Date(now.getTime() + BUSY_AHEAD_MS),
          );
          await tx.calendarBusy.deleteMany({ where: { userId: conn.userId } });
          if (busy.length) {
            await tx.calendarBusy.createMany({
              data: busy.map((i) => ({ userId: conn.userId, startsAt: i.start, endsAt: i.end })),
            } as Parameters<typeof tx.calendarBusy.createMany>[0]);
          }
          await tx.calendarConnection.updateMany({
            where: { id: conn.id },
            data: { busySyncedAt: now },
          });
          result.busyRefreshed++;
        } catch (e) {
          // Busy times stay as they were; a refused token needs the coach to reconnect.
          await tx.calendarConnection.updateMany({
            where: { id: conn.id },
            data: e instanceof CalendarAuthError ? { status: 'error' } : { busySyncedAt: now },
          });
        }
      },
      prisma,
    );
  }
  return result;
}
