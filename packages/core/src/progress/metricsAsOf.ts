import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { fromDbDate, toDbDate } from '../sessions/read';
import { isUuid } from '../uuid';
import type { BodyMetric } from './metric-catalog';

export interface MetricAsOf {
  metric: BodyMetric;
  /** Canonical units. */
  value: number;
  measuredOn: string;
}

/**
 * For each date, the latest value of every measurement recorded on or before it (PRD F6: metric deltas between two
 * check-ins). Dates are client-local YYYY-MM-DD; at most 100.
 */
export async function metricsAsOf(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  dates: string[],
): Promise<Record<string, MetricAsOf[]>> {
  assertCan(actor, 'metric:read');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Not found.');
  if (actor.role === 'client' && actor.clientId?.toLowerCase() !== clientId.toLowerCase()) {
    throw new DomainError('NOT_FOUND', 'Not found.');
  }
  const wanted = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 100);
  if (wanted.length === 0) return {};
  const latest = wanted.reduce((a, b) => (a > b ? a : b));
  const rows = await tx.metricEntry.findMany({
    where: { clientId, measuredOn: { lte: toDbDate(latest) } },
    orderBy: { measuredOn: 'asc' },
    select: { metric: true, value: true, measuredOn: true },
  });
  const out: Record<string, MetricAsOf[]> = {};
  for (const date of wanted) {
    const at = new Map<BodyMetric, MetricAsOf>();
    for (const r of rows) {
      const on = fromDbDate(r.measuredOn);
      if (on > date) break;
      at.set(r.metric, { metric: r.metric, value: Number(r.value.toString()), measuredOn: on });
    }
    out[date] = [...at.values()];
  }
  return out;
}
