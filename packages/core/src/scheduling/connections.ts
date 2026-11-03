import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import type { CalendarProvider } from './calendarSync';

/** D-013 #11: a coach's own calendar connection (one per workspace membership). */
export interface CalendarConnectionView {
  provider: CalendarProvider;
  accountEmail: string | null;
  status: 'active' | 'revoked' | 'error';
  busySyncedAt: string | null;
}

export async function getCalendarConnection(
  tx: TenantTx,
  actor: ActorContext,
): Promise<CalendarConnectionView | null> {
  assertCan(actor, 'schedule:manage');
  const c = await tx.calendarConnection.findFirst({
    where: { userId: actor.userId, status: { not: 'revoked' } },
    select: { provider: true, accountEmail: true, status: true, busySyncedAt: true },
  });
  return c
    ? {
        provider: c.provider as CalendarProvider,
        accountEmail: c.accountEmail,
        status: c.status as CalendarConnectionView['status'],
        busySyncedAt: c.busySyncedAt?.toISOString() ?? null,
      }
    : null;
}

/** Saves (or replaces) the coach's connection; their upcoming sessions are queued to be pushed. */
export async function saveCalendarConnection(
  tx: TenantTx,
  actor: ActorContext,
  input: { provider: CalendarProvider; tokenCiphertext: string; accountEmail: string | null },
  ctx: { now?: Date; requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'schedule:manage');
  const now = ctx.now ?? new Date();
  const data = {
    provider: input.provider,
    tokenCiphertext: input.tokenCiphertext,
    accountEmail: input.accountEmail,
    status: 'active',
    busySyncedAt: null,
    calendarId: 'primary',
  };
  const { count } = await tx.calendarConnection.updateMany({
    where: { userId: actor.userId },
    data,
  });
  if (count === 0) {
    await tx.calendarConnection.create({
      data: { ...data, userId: actor.userId },
    } as Parameters<typeof tx.calendarConnection.create>[0]);
  }
  await tx.booking.updateMany({
    where: { coachUserId: actor.userId, status: 'booked', startsAt: { gt: now } },
    data: { syncState: 'pending', syncAttempts: 0, calendarEventRef: null },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'calendar_connection',
    objectId: actor.userId,
    action: 'calendar.connected',
    metadata: { provider: input.provider },
    requestId: ctx.requestId,
  });
}

/** Forgets the tokens and the busy cache. Events already pushed stay in the coach's calendar. */
export async function disconnectCalendar(
  tx: TenantTx,
  actor: ActorContext,
  ctx: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'schedule:manage');
  await tx.calendarConnection.deleteMany({ where: { userId: actor.userId } });
  await tx.calendarBusy.deleteMany({ where: { userId: actor.userId } });
  await tx.booking.updateMany({
    where: { coachUserId: actor.userId, syncState: 'pending' },
    data: { syncState: 'none' },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'calendar_connection',
    objectId: actor.userId,
    action: 'calendar.disconnected',
    requestId: ctx.requestId,
  });
}
