import type { TenantTx } from '@repsy/db';
import { DomainError } from '../errors';
import { fromDbDate, summarize, SUMMARY_SELECT } from '../sessions/read';
import { isUuid } from '../uuid';

/** PRD H3: what a message is about. */
export type AnchorType = 'session' | 'checkin';
export interface MessageAnchor {
  type: AnchorType;
  id: string;
  /** "Upper A, Tue 3 Nov" or "Check-in, week of 3 Nov", captured when the message was sent. */
  label: string;
}

const invalid = () =>
  new DomainError('VALIDATION', 'Some fields are invalid.', {
    anchor: ['That workout or check-in is not in this conversation.'],
  });

const day = (localDate: string, weekday: boolean) =>
  new Intl.DateTimeFormat('en-GB', {
    ...(weekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(`${localDate}T00:00:00Z`))
    .replace(',', '');

/** "session:<uuid>" or "checkin:<uuid>" (a URL parameter) to an anchor reference, or null. */
export function parseAnchorRef(v: unknown): { type: AnchorType; id: string } | null {
  if (typeof v !== 'string') return null;
  const [type, id] = v.split(':');
  if ((type === 'session' || type === 'checkin') && isUuid(id)) return { type, id: id as string };
  return null;
}

/**
 * Checks that the workout or check-in belongs to `clientId` (the thread's client) and builds its label. A cancelled
 * workout, or anything of another client, is a validation error on `anchor`.
 */
export async function resolveAnchor(
  tx: TenantTx,
  clientId: string,
  ref: { type?: unknown; id?: unknown },
  now: Date = new Date(),
): Promise<MessageAnchor> {
  if ((ref.type !== 'session' && ref.type !== 'checkin') || !isUuid(ref.id)) throw invalid();
  const id = ref.id as string;
  if (ref.type === 'session') {
    const row = await tx.workoutSession.findFirst({
      where: { id, clientId, state: { not: 'cancelled' } },
      select: SUMMARY_SELECT,
    });
    if (!row) throw invalid();
    const [summary] = await summarize(tx, [row], now);
    const label = `${summary?.title ?? 'Workout'}, ${day(fromDbDate(row.scheduledLocalDate), true)}`;
    return { type: 'session', id, label: label.slice(0, 160) };
  }
  const checkin = await tx.checkin.findFirst({
    where: { id, clientId },
    select: { periodLocalDate: true },
  });
  if (!checkin) throw invalid();
  return {
    type: 'checkin',
    id,
    label: `Check-in, week of ${day(fromDbDate(checkin.periodLocalDate), false)}`,
  };
}

/** The stored columns as a view, or null. */
export function anchorOf(row: {
  anchorType: string | null;
  anchorId: string | null;
  anchorLabel: string | null;
}): MessageAnchor | null {
  if ((row.anchorType !== 'session' && row.anchorType !== 'checkin') || !row.anchorId) return null;
  return { type: row.anchorType, id: row.anchorId, label: row.anchorLabel ?? '' };
}
