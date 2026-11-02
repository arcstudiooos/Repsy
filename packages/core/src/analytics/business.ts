import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { CHURN_REASONS, type ChurnReason } from '../clients/churn';
import { todayInZone } from '../timezone';

/**
 * PRD I7: business analytics from the client list. A client "starts" when they accept their invite and "ends" when
 * they are archived. Retention cohorts group clients by the month they started and show the share still coached
 * 1, 3 and 6 months later (only once that time has passed). Revenue joins this when payments are taken (K9).
 */
export interface Cohort {
  month: string;
  started: number;
  /** Share (0-100) still coached after 1, 3 and 6 months; null until that time has passed. */
  retained: { after: 1 | 3 | 6; percent: number | null }[];
}

export interface BusinessAnalytics {
  activeNow: number;
  startedLast90: number;
  endedLast90: number;
  /** Days, over everyone who has ever started; ongoing clients count up to today. */
  averageLifetimeDays: number | null;
  medianLifetimeDays: number | null;
  cohorts: Cohort[];
  /** Months, oldest first, with how many started and ended. */
  monthly: { month: string; started: number; ended: number }[];
  /** Why coaching ended, over the last 12 months (unknown when no reason was given). */
  churnReasons: { reason: ChurnReason | 'unknown'; count: number }[];
}

const DAY = 86_400_000;
const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthStart = (month: string) => new Date(`${month}-01T00:00:00.000Z`);

export async function getBusinessAnalytics(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<BusinessAnalytics> {
  assertCan(actor, 'analytics:read');
  const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
  const thisMonth = todayInZone(org.timezone, now).slice(0, 7);
  const rows = await tx.client.findMany({
    where: { consentAt: { not: null } },
    select: { consentAt: true, archivedAt: true, churnReason: true, status: true },
  });
  const clients = rows.map((r) => ({
    start: r.consentAt!,
    end: r.status === 'archived' ? (r.archivedAt ?? now) : null,
    reason: r.churnReason as ChurnReason | null,
  }));
  const coachedAt = (c: (typeof clients)[number], t: Date) =>
    c.start <= t && (c.end === null || c.end > t);

  const lifetimes = clients
    .map((c) => ((c.end ?? now).getTime() - c.start.getTime()) / DAY)
    .sort((a, b) => a - b);
  const mid = Math.floor(lifetimes.length / 2);
  const median =
    lifetimes.length === 0
      ? null
      : lifetimes.length % 2
        ? lifetimes[mid]!
        : (lifetimes[mid - 1]! + lifetimes[mid]!) / 2;

  const cohorts: Cohort[] = [];
  for (let i = 11; i >= 0; i--) {
    const month = addMonths(thisMonth, -i);
    const members = clients.filter((c) => monthOf(c.start) === month);
    if (members.length === 0) continue;
    cohorts.push({
      month,
      started: members.length,
      retained: ([1, 3, 6] as const).map((after) => {
        const at = monthStart(addMonths(month, after));
        if (at > now) return { after, percent: null };
        const still = members.filter((c) => coachedAt(c, at)).length;
        return { after, percent: Math.round((still / members.length) * 100) };
      }),
    });
  }

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(thisMonth, i - 11);
    return {
      month,
      started: clients.filter((c) => monthOf(c.start) === month).length,
      ended: clients.filter((c) => c.end && monthOf(c.end) === month).length,
    };
  });

  const since = new Date(now.getTime() - 365 * DAY);
  const recent = clients.filter((c) => c.end && c.end >= since);
  const churnReasons = [...CHURN_REASONS, 'unknown' as const]
    .map((reason) => ({
      reason,
      count: recent.filter((c) => (c.reason ?? 'unknown') === reason).length,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const d90 = new Date(now.getTime() - 90 * DAY);
  return {
    activeNow: clients.filter((c) => c.end === null).length,
    startedLast90: clients.filter((c) => c.start >= d90).length,
    endedLast90: clients.filter((c) => c.end && c.end >= d90).length,
    averageLifetimeDays: lifetimes.length
      ? Math.round(lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length)
      : null,
    medianLifetimeDays: median === null ? null : Math.round(median),
    cohorts,
    monthly,
    churnReasons,
  };
}
