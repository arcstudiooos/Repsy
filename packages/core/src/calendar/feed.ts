import { appendAudit, withSystem, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { hashInviteToken, newInviteToken } from '../invites/token';
import { summarize, SUMMARY_SELECT, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';

/**
 * PRD L7: a private ICS feed of the client's workouts, for any calendar app. The link's token is the only key (only
 * its hash is stored); a new link replaces it. Events are all-day on the workout's date with its title only: no notes,
 * targets or anything the client logged.
 */
export const FEED_PAST_DAYS = 30;
export const FEED_AHEAD_DAYS = 120;

const forClient = (actor: ActorContext) => {
  if (actor.role !== 'client' || !actor.clientId) {
    throw new DomainError('FORBIDDEN', 'Only the client can manage their calendar link.');
  }
  return actor.clientId;
};

/** Makes (or replaces) the client's feed link. The token is returned once; it can't be shown again. */
export async function rotateCalendarToken(
  tx: TenantTx,
  actor: ActorContext,
  opts: { requestId?: string } = {},
): Promise<{ token: string }> {
  const clientId = forClient(actor);
  const { token, tokenHash } = newInviteToken();
  await tx.client.update({ where: { id: clientId }, data: { calendarTokenHash: tokenHash } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: clientId,
    action: 'client.calendar_link_made',
    metadata: { clientId },
    requestId: opts.requestId,
  });
  return { token };
}

export async function revokeCalendarToken(tx: TenantTx, actor: ActorContext): Promise<void> {
  const clientId = forClient(actor);
  await tx.client.update({ where: { id: clientId }, data: { calendarTokenHash: null } });
}

export async function hasCalendarFeed(tx: TenantTx, actor: ActorContext): Promise<boolean> {
  const clientId = forClient(actor);
  const c = await tx.client.findFirst({
    where: { id: clientId },
    select: { calendarTokenHash: true },
  });
  return Boolean(c?.calendarTokenHash);
}

/** RFC 5545 text escaping, and lines folded at 75 octets. */
export const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}
const ymd = (d: string) => d.replace(/-/g, '');
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const nextDay = (d: string) =>
  new Date(toDbDate(d).getTime() + 86_400_000).toISOString().slice(0, 10);

/**
 * The feed for `token`, or null for an unknown, replaced or archived client's link. The lookup is a system read by
 * the token's hash (the token is the only credential, like an invite link); the events are read in the client's
 * organization.
 */
export async function calendarFeed(
  prisma: PrismaClient,
  token: string,
  opts: { now?: Date; appBaseUrl?: string } = {},
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const now = opts.now ?? new Date();
  const client = await withSystem(
    (tx) =>
      tx.client.findFirst({
        where: { calendarTokenHash: hashInviteToken(token), status: { not: 'archived' } },
        select: { id: true, organizationId: true, timezone: true },
      }),
    prisma,
  );
  if (!client) return null;
  const today = todayInZone(client.timezone, now);
  const from = new Date(toDbDate(today).getTime() - FEED_PAST_DAYS * 86_400_000);
  const until = new Date(toDbDate(today).getTime() + FEED_AHEAD_DAYS * 86_400_000);
  const { sessions, bookings } = await withTenant(
    client.organizationId,
    async (tx) => {
      // PRD K10 (D-013 #11): booked sessions join the feed as timed events.
      const bookings = await tx.booking.findMany({
        where: { clientId: client.id, status: 'booked', startsAt: { gte: from, lte: until } },
        orderBy: { startsAt: 'asc' },
        take: 200,
        select: { id: true, title: true, startsAt: true, endsAt: true },
      });
      const rows = await tx.workoutSession.findMany({
        where: {
          clientId: client.id,
          state: { not: 'cancelled' },
          scheduledLocalDate: { gte: from, lte: until },
        },
        orderBy: { scheduledLocalDate: 'asc' },
        take: 500,
        select: SUMMARY_SELECT,
      });
      return { sessions: await summarize(tx, rows, now), bookings };
    },
    prisma,
  );
  const base = (opts.appBaseUrl ?? '').replace(/\/+$/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kinetic//Workouts//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Kinetic workouts',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const s of sessions) {
    const done = s.state === 'completed' ? ' (done)' : s.state === 'skipped' ? ' (skipped)' : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@kinetic`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${ymd(s.scheduledLocalDate)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(s.scheduledLocalDate))}`,
      `SUMMARY:${esc(`${s.title}${done}`)}`,
      ...(base ? [`URL:${base}/portal/workouts/${s.id}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  for (const b of bookings) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:booking-${b.id}@kinetic`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(b.startsAt)}`,
      `DTEND:${stamp(b.endsAt)}`,
      `SUMMARY:${esc(b.title)}`,
      ...(base ? [`URL:${base}/portal/sessions`] : []),
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
