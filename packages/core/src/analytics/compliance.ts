import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { addToAdherence, emptyAdherence, graceMs, type AdherenceCounts } from './adherence';

const DAY_MS = 86_400_000;

/** Rolling windows shown per client (PRD I5): the last 7, 30 and 90 days, ending today in the client's time zone. */
export const COMPLIANCE_WINDOWS = [7, 30, 90] as const;
export type ComplianceWindow = (typeof COMPLIANCE_WINDOWS)[number];

/** One client's adherence for each rolling window, counted by the same rules as the analytics page. */
export type ClientCompliance = Record<ComplianceWindow, AdherenceCounts>;

const addDays = (localDate: string, days: number): string =>
  fromDbDate(new Date(toDbDate(localDate).getTime() + days * DAY_MS));

/**
 * Per-client compliance (PRD I5) over rolling 7, 30 and 90-day windows. A session counts in a window when its
 * scheduled local date falls in the last N days of the client's own calendar (today inclusive) and its due window
 * (due + grace) has ended. The rules match `adherence` (D-008 clar. 1): cancelled sessions are excluded, paused time
 * never counts (a pause moves its sessions), and skipped, incomplete and missed stay in the denominator.
 *
 * Clients outside the actor's organization are invisible through tenant scoping and simply have no entry.
 */
export async function clientCompliance(
  tx: TenantTx,
  actor: ActorContext,
  clientIds: readonly string[],
  opts: { now?: Date } = {},
): Promise<Map<string, ClientCompliance>> {
  assertCan(actor, 'client:read');
  const result = new Map<string, ClientCompliance>();
  if (clientIds.length === 0) return result;
  const now = opts.now ?? new Date();

  const clients = await tx.client.findMany({
    where: { id: { in: [...clientIds] } },
    select: { id: true, timezone: true },
  });
  if (clients.length === 0) return result;

  // A zone Intl cannot use leaves that one client without figures instead of failing the whole page.
  const today = new Map<string, string>();
  for (const c of clients) {
    try {
      today.set(c.id, todayInZone(c.timezone, now));
    } catch {
      continue;
    }
  }
  if (today.size === 0) return result;
  const todays = [...today.values()].sort();
  const longest = Math.max(...COMPLIANCE_WINDOWS);
  const earliest = addDays(todays[0] as string, -(longest - 1));
  const latest = todays[todays.length - 1] as string;

  const cutoff = new Date(now.getTime() - (await graceMs(tx)));

  const rows = await tx.workoutSession.groupBy({
    by: ['clientId', 'state', 'scheduledLocalDate'],
    where: {
      clientId: { in: [...today.keys()] },
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(earliest), lte: toDbDate(latest) },
      dueAt: { lt: cutoff },
    },
    _count: { _all: true },
  });

  for (const id of today.keys()) {
    result.set(id, { 7: emptyAdherence(), 30: emptyAdherence(), 90: emptyAdherence() });
  }
  for (const row of rows) {
    const counts = result.get(row.clientId);
    const clientToday = today.get(row.clientId);
    if (!counts || !clientToday) continue;
    const date = fromDbDate(row.scheduledLocalDate);
    const n = row._count._all;
    for (const days of COMPLIANCE_WINDOWS) {
      if (date > clientToday || date < addDays(clientToday, -(days - 1))) continue;
      addToAdherence(counts[days], row.state, n);
    }
  }
  return result;
}
