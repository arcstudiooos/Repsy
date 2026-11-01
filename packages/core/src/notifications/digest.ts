import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { listCheckinsAwaitingReview } from '../checkins/checkins';
import { unreadMessageCount } from '../messages/messages';
import { enqueueEmail } from '../outbox';
import { countOpenFlags } from '../review/flags';
import { todayInZone } from '../timezone';

/** The digest goes out from this local hour on, once per local day (PRD H14). */
export const DIGEST_HOUR = 7;

const localHour = (timeZone: string, now: Date) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now),
  );

/**
 * Queues each opted-in coach's daily digest in this organization (PRD H14): counts of sent check-ins waiting for
 * review, unread client messages and open review items, with a link. Never client names or content (D-007). Sent
 * from 07:00 in the organization's time zone, once per local day (idempotency key), and not at all when there is
 * nothing to report. Idempotent; the worker runs it hourly.
 */
export async function queueCoachDigests(
  tx: TenantTx,
  orgId: string,
  now: Date,
): Promise<{ queued: number }> {
  const org = await tx.organization.findFirst({ select: { name: true, timezone: true } });
  if (!org) return { queued: 0 };
  if (localHour(org.timezone, now) < DIGEST_HOUR) return { queued: 0 };
  const day = todayInZone(org.timezone, now);
  const coaches = await tx.membership.findMany({
    where: { role: { in: ['owner', 'coach'] }, status: 'active' },
    select: { userId: true, role: true },
  });
  let queued = 0;
  for (const m of coaches) {
    const pref = await tx.notificationPreference.findUnique({
      where: { userId: m.userId },
      select: { digestEmailOptIn: true },
    });
    if (!pref?.digestEmailOptIn) continue;
    const actor: ActorContext = {
      userId: m.userId,
      orgId,
      role: m.role as 'owner' | 'coach',
      isPlatformAdmin: false,
    };
    const checkins = (await listCheckinsAwaitingReview(tx, actor, { limit: 1 })).total;
    const unread = await unreadMessageCount(tx, actor);
    const flags = (await countOpenFlags(tx, actor)).total;
    if (checkins + unread + flags === 0) continue;
    if (
      await enqueueEmail(tx, {
        kind: 'coach_digest',
        toUserId: m.userId,
        templateKey: 'coach_digest',
        payload: { orgName: org.name, checkins, unread, flags },
        idempotencyKey: `coach-digest:${orgId}:${m.userId}:${day}`,
      })
    ) {
      queued += 1;
    }
  }
  return { queued };
}
