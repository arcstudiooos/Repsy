import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import type { Units } from '../units';
import { isUuid } from '../uuid';
import {
  BODY_METRICS,
  isBodyMetric,
  metricDef,
  metricFromCanonical,
  metricToCanonical,
  metricUnit,
  type BodyMetric,
} from './metric-catalog';

export * from './metric-catalog';

/** How far back a value may be dated. */
export const MAX_BACKDATE_DAYS = 3650;
/** The most entries returned per metric, newest first. */
export const METRIC_HISTORY_LIMIT = 400;
export const METRIC_REASON_MAX = 500;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MetricEntryView {
  id: string;
  metric: BodyMetric;
  measuredOn: string;
  /** Canonical units (kg, cm, %, bpm, steps). */
  value: number;
  source: 'client' | 'coach';
  /** True once the value has been changed after it was first recorded. */
  edited: boolean;
  updatedAt: string;
}

export interface MetricsView {
  units: Units;
  todayLocalDate: string;
  /** Metrics with at least one entry, in catalogue order; entries newest first. */
  series: { metric: BodyMetric; entries: MetricEntryView[] }[];
}

export interface RecordMetricInput {
  metric?: unknown;
  measuredOn?: unknown;
  /** In the client's units (`metricUnit`). */
  value?: unknown;
  /** Required when a coach changes an existing value. Never shown to the client. */
  reason?: unknown;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

type Decimalish = { toString(): string };
const num = (d: Decimalish): number => Number(d.toString());

/** A client reads and writes only their own record; a coach any client in the organization (RLS hides others). */
async function resolveClient(tx: TenantTx, actor: ActorContext, clientId: string) {
  if (!isUuid(clientId)) throw notFound();
  if (actor.role === 'client' && actor.clientId?.toLowerCase() !== clientId.toLowerCase()) {
    throw notFound();
  }
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, organizationId: true, timezone: true, preferredUnits: true },
  });
  if (!client) throw notFound();
  return client;
}

const todayFor = (timezone: string, now: Date): string => {
  try {
    return todayInZone(timezone, now);
  } catch {
    return todayInZone('UTC', now);
  }
};

function toView(row: {
  id: string;
  metric: BodyMetric;
  measuredOn: Date;
  value: Decimalish;
  source: 'client' | 'coach';
  updatedAt: Date;
  _count: { revisions: number };
}): MetricEntryView {
  return {
    id: row.id,
    metric: row.metric,
    measuredOn: fromDbDate(row.measuredOn),
    value: num(row.value),
    source: row.source,
    edited: row._count.revisions > 0,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const VIEW_SELECT = {
  id: true,
  metric: true,
  measuredOn: true,
  value: true,
  source: true,
  updatedAt: true,
  _count: { select: { revisions: true } },
} as const;

/** The client's body metrics (PRD E1), per metric, newest first. */
export async function listMetrics(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { now?: Date } = {},
): Promise<MetricsView> {
  assertCan(actor, 'metric:read');
  const client = await resolveClient(tx, actor, clientId);
  // One query, newest first per metric; at most METRIC_HISTORY_LIMIT entries kept per metric.
  const rows = await tx.metricEntry.findMany({
    where: { clientId: client.id },
    orderBy: [{ metric: 'asc' }, { measuredOn: 'desc' }],
    select: VIEW_SELECT,
  });
  const byMetric = new Map<BodyMetric, MetricEntryView[]>();
  for (const row of rows) {
    const list = byMetric.get(row.metric) ?? [];
    if (list.length < METRIC_HISTORY_LIMIT) list.push(toView(row));
    byMetric.set(row.metric, list);
  }
  const series: MetricsView['series'] = BODY_METRICS.filter((d) => byMetric.has(d.key)).map(
    (d) => ({ metric: d.key, entries: byMetric.get(d.key) as MetricEntryView[] }),
  );
  return {
    units: client.preferredUnits,
    todayLocalDate: todayFor(client.timezone, opts.now ?? new Date()),
    series,
  };
}

/**
 * Records a body metric for a client-local day (PRD E1). One value per metric and day: a second write for the same
 * day changes the value and adds an append-only revision; writing the same value again is a no-op (safe replay). A
 * coach changing an existing value must give a reason (shown to coaches only, like log corrections).
 */
export async function recordMetric(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: RecordMetricInput,
  opts: { now?: Date } = {},
): Promise<MetricEntryView> {
  assertCan(actor, 'metric:write');
  const client = await resolveClient(tx, actor, clientId);
  const now = opts.now ?? new Date();

  if (!isBodyMetric(input.metric)) throw invalid('metric', 'Choose a metric.');
  const def = metricDef(input.metric);

  const measuredOn = input.measuredOn;
  if (
    typeof measuredOn !== 'string' ||
    !DATE.test(measuredOn) ||
    fromDbDate(toDbDate(measuredOn)) !== measuredOn
  ) {
    throw invalid('measuredOn', 'Use YYYY-MM-DD.');
  }
  const today = todayFor(client.timezone, now);
  if (measuredOn > today) throw invalid('measuredOn', 'Pick today or an earlier day.');
  const earliest = fromDbDate(new Date(toDbDate(today).getTime() - MAX_BACKDATE_DAYS * DAY_MS));
  if (measuredOn < earliest) throw invalid('measuredOn', 'Pick a day in the last 10 years.');

  if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
    throw invalid('value', 'Enter a number.');
  }
  const units = client.preferredUnits;
  const canonical = metricToCanonical(def.kind, input.value, units);
  if (canonical < def.min || canonical > def.max) {
    const lo = metricFromCanonical(def.kind, def.min, units);
    const hi = metricFromCanonical(def.kind, def.max, units);
    throw invalid('value', `Enter ${lo}-${hi} ${metricUnit(def.kind, units)}.`);
  }
  const value = def.kind === 'bpm' || def.kind === 'count' ? Math.round(canonical) : canonical;
  const role = actor.role === 'client' ? 'client' : 'coach';
  const where = {
    clientId_metric_measuredOn: {
      clientId: client.id,
      metric: def.key,
      measuredOn: toDbDate(measuredOn),
    },
  };

  // ON CONFLICT DO NOTHING: a double tap or a second device writing the same day never fails on the unique key.
  const created = await tx.metricEntry.createMany({
    data: [
      {
        organizationId: client.organizationId,
        clientId: client.id,
        metric: def.key,
        measuredOn: toDbDate(measuredOn),
        value,
        source: role,
        recordedByUserId: actor.userId,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return toView(await tx.metricEntry.findUniqueOrThrow({ where, select: VIEW_SELECT }));
  }
  const existing = await tx.metricEntry.findUniqueOrThrow({
    where,
    select: { id: true, value: true },
  });
  const before = num(existing.value);
  if (Math.abs(before - value) < 0.0005) {
    const row = await tx.metricEntry.findUniqueOrThrow({ where, select: VIEW_SELECT });
    return toView(row);
  }

  let reason: string | null = null;
  if (role === 'coach') {
    const r = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (r.length < 1 || r.length > METRIC_REASON_MAX) {
      throw invalid('reason', `Give a reason (1-${METRIC_REASON_MAX} characters).`);
    }
    reason = r;
  }
  await tx.metricEntryRevision.create({
    data: {
      organizationId: client.organizationId,
      clientId: client.id,
      entryId: existing.id,
      beforeValue: before,
      afterValue: value,
      role,
      reason,
      revisedByUserId: actor.userId,
    },
  });
  const row = await tx.metricEntry.update({
    where: { id: existing.id },
    data: { value, source: role, recordedByUserId: actor.userId },
    select: VIEW_SELECT,
  });
  return toView(row);
}
