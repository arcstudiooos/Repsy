import type { Metadata } from 'next';
import Link from 'next/link';
import { ChartColumn } from 'lucide-react';
import {
  DomainError,
  getAnalytics,
  getClientAdherence,
  isoWeekOf,
  todayInZone,
  type AnalyticsView,
} from '@repsy/core';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { Donut } from '@/components/charts/Donut';
import { AreaChart, BarChart } from '@/components/charts/Interactive';
import { STATE_COLOR, STATE_LABEL } from '@/components/charts/palette';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { Section } from '@/components/ui/section';
import { SegmentedLinks } from '@/components/ui/segmented';
import { StatTile } from '@/components/ui/stat-tile';
import { dayMonth } from '@/lib/relative-time';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../clients/StatusBadge';

export const metadata: Metadata = { title: 'Analytics | Repsy' };

const DAY_MS = 86_400_000;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const addDays = (d: string, n: number) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const PRESETS = [
  { weeks: 1, label: 'This week' },
  { weeks: 4, label: '4 weeks' },
  { weeks: 12, label: '12 weeks' },
] as const;
const SORTS = ['name', 'adherence', 'workouts'] as const;
const FOLLOW_UP_BUCKETS = [
  { label: 'Under 4 h', under: 4 },
  { label: '4–24 h', under: 24 },
  { label: '1–3 days', under: 72 },
  { label: 'Over 3 days', under: Infinity },
];

/**
 * Coach analytics (S5-1, D-014): each figure keeps its numerator, denominator and period in text; charts restate
 * them and every chart has a table view. The range is a preset (this week, 4 or 12 weeks ending this week, in the
 * workspace's time zone) or a custom From / To.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const preset = PRESETS.find((p) => String(p.weeks) === first(sp.r));
  const sort = SORTS.find((s) => s === first(sp.sort)) ?? 'adherence';
  const result = await withServerTenant(async (tx, actor) => {
    const org = await tx.organization.findFirst({ select: { timezone: true } });
    const week = isoWeekOf(todayInZone(org?.timezone ?? 'UTC'));
    const weeks = preset?.weeks ?? 1;
    const custom = !preset && (first(sp.from) || first(sp.to));
    const range = custom
      ? { from: first(sp.from) ?? week.start, to: first(sp.to) ?? week.end }
      : { from: addDays(week.start, -7 * (weeks - 1)), to: week.end };
    let view: AnalyticsView;
    try {
      view = await getAnalytics(tx, actor, range);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'VALIDATION') {
        const message = Object.values(error.fieldErrors ?? {})[0]?.[0] ?? error.message;
        return {
          range,
          view: null,
          error: message,
          trend: [],
          previous: null,
          clients: [],
          weeks,
          followUp: [],
        };
      }
      throw error;
    }
    // Weekly trend over the range (at most 12 weeks, the most recent ones).
    const startWeek = isoWeekOf(range.from).start;
    const trendStarts: string[] = [];
    for (let s = startWeek; s <= range.to && trendStarts.length < 53; s = addDays(s, 7))
      trendStarts.push(s);
    const trend = [];
    for (const s of trendStarts.slice(-12)) {
      const v = await getAnalytics(tx, actor, { from: s, to: addDays(s, 6) });
      trend.push({ weekStart: s, view: v });
    }
    // The same-length period just before, for deltas.
    const len = Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY_MS) + 1;
    const previous = await getAnalytics(tx, actor, {
      from: addDays(range.from, -len),
      to: addDays(range.from, -1),
    }).catch(() => null);
    const roster = await tx.client.findMany({
      where: { status: { in: ['active', 'paused'] } },
      select: { id: true, name: true },
      take: 300,
    });
    const adh = await getClientAdherence(
      tx,
      actor,
      roster.map((c) => c.id),
      { days: Math.min(Math.max(len, 7), 366) },
    );
    const clients = roster.map((c) => ({ ...c, row: adh.get(c.id) ?? null }));
    // Time to follow-up, bucketed (the same items getAnalytics takes the median of).
    const closed = await tx.reviewFlag.findMany({
      where: {
        state: { in: ['resolved', 'dismissed'] },
        resolvedBy: { not: null },
        resolvedAt: {
          gte: new Date(`${range.from}T00:00:00Z`),
          lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS),
        },
      },
      select: { createdAt: true, resolvedAt: true },
    });
    const followUp = FOLLOW_UP_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
    for (const f of closed) {
      const h = ((f.resolvedAt as Date).getTime() - f.createdAt.getTime()) / 3_600_000;
      const i = FOLLOW_UP_BUCKETS.findIndex((b) => h < b.under);
      followUp[i === -1 ? followUp.length - 1 : i]!.count += 1;
    }
    return { range, view, error: null, trend, previous, clients, weeks, followUp };
  });
  const { range, view } = result;
  const period = `${formatDate(range.from)} to ${formatDate(range.to)}`;
  const qs = (p: Record<string, string>) => `/app/analytics?${new URLSearchParams(p).toString()}`;

  const header = (
    <PageHeader
      title="Analytics"
      subtitle="How your clients are training and checking in, for the period you pick."
      actions={
        <Link href="/app/analytics/business" className={buttonVariants({ variant: 'secondary' })}>
          <ChartColumn aria-hidden />
          Business analytics
        </Link>
      }
    />
  );
  const controls = (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <SegmentedLinks
        label="Period"
        options={PRESETS.map((p) => ({
          href: qs({ r: String(p.weeks) }),
          label: p.label,
          current: !first(sp.from) && !first(sp.to) && (preset?.weeks ?? 1) === p.weeks,
        }))}
      />
      <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Custom period">
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-sm font-medium">
            From
          </label>
          <Input id="from" name="from" type="date" defaultValue={range.from} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-sm font-medium">
            To
          </label>
          <Input id="to" name="to" type="date" defaultValue={range.to} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
    </div>
  );

  if (!view) {
    return (
      <>
        {header}
        {controls}
        <p role="alert" className="mb-6 text-danger">
          {result.error}
        </p>
      </>
    );
  }

  const a = view.adherence;
  const adh = pctOf(a.completed, a.eligible);
  const res = pctOf(view.responseRate.numerator, view.responseRate.denominator);
  const prev = result.previous;
  const prevAdh = prev ? pctOf(prev.adherence.completed, prev.adherence.eligible) : null;
  const prevRes = prev ? pctOf(prev.responseRate.numerator, prev.responseRate.denominator) : null;
  const pts = (v: number) => `${v} ${v === 1 ? 'pt' : 'pts'}`;
  const trendRows = result.trend.map((t) => ({
    week: dayMonth(t.weekStart),
    adherence: pctOf(t.view.adherence.completed, t.view.adherence.eligible),
    response: pctOf(t.view.responseRate.numerator, t.view.responseRate.denominator),
    assigned: t.view.workouts.assigned,
    finished: t.view.workouts.finished,
  }));
  const sorted = [...result.clients].sort((x, y) =>
    sort === 'name'
      ? x.name.localeCompare(y.name)
      : sort === 'workouts'
        ? (y.row?.counts.completed ?? 0) - (x.row?.counts.completed ?? 0)
        : (x.row?.adherencePct ?? 101) - (y.row?.adherencePct ?? 101),
  );
  const sortHref = (s: (typeof SORTS)[number]) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && k !== 'sort') p.set(k, v);
    p.set('sort', s);
    return `/app/analytics?${p.toString()}`;
  };

  return (
    <>
      {header}
      {controls}
      <p className="-mt-3 mb-6 text-caption text-secondary">Period: {period}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <ChartFrame
            titleAs="h2"
            title="Adherence"
            summary={
              a.eligible === 0
                ? `Nothing was due for adherence in ${period}.`
                : `${a.completed} of ${a.eligible} due workouts completed (${adh}%): ${a.skipped} skipped, ${a.incomplete} not finished, ${a.missed} missed, in ${period}.`
            }
            legend={[
              { label: STATE_LABEL.completed, color: STATE_COLOR.completed },
              { label: STATE_LABEL.skipped, color: STATE_COLOR.skipped },
              { label: STATE_LABEL.notFinished, color: STATE_COLOR.notFinished },
              { label: STATE_LABEL.missed, color: STATE_COLOR.missed },
            ]}
            table={{
              columns: ['Week', 'Adherence'],
              rows: trendRows.map((r) => [r.week, r.adherence === null ? '–' : `${r.adherence}%`]),
            }}
          >
            {a.eligible === 0 ? (
              <p className="text-secondary">No sessions due yet</p>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Donut
                  centre={`${adh}%`}
                  centreLabel={`${a.completed} of ${a.eligible}`}
                  parts={[
                    { label: 'Completed', value: a.completed, color: STATE_COLOR.completed },
                    { label: 'Skipped', value: a.skipped, color: STATE_COLOR.skipped },
                    { label: 'Not finished', value: a.incomplete, color: STATE_COLOR.notFinished },
                    { label: 'Missed', value: a.missed, color: STATE_COLOR.missed },
                  ]}
                />
                {trendRows.length > 1 && (
                  <div className="min-w-0 flex-1">
                    <AreaChart
                      height={150}
                      data={trendRows}
                      x="week"
                      unit="%"
                      series={[{ key: 'adherence', label: 'Adherence' }]}
                    />
                  </div>
                )}
              </div>
            )}
          </ChartFrame>
          <p className="mt-2 text-caption text-secondary">
            Paused and cancelled workouts are not counted.
          </p>
        </Card>

        <Card>
          <ChartFrame
            titleAs="h2"
            title="Assigned vs finished"
            summary={`${view.workouts.finished} finished (completed or skipped) of ${view.workouts.assigned} assigned workouts scheduled ${period}.`}
            legend={[
              { label: 'Assigned', color: 'var(--k-chart-6)' },
              { label: 'Finished', color: 'var(--k-chart-1)' },
            ]}
            table={{
              columns: ['Week', 'Assigned', 'Finished'],
              rows: trendRows.map((r) => [r.week, r.assigned, r.finished]),
            }}
          >
            <p className="mb-3">
              <span className="tabular text-display font-semibold">{view.workouts.finished}</span>{' '}
              <span className="text-secondary">of {view.workouts.assigned} assigned</span>
            </p>
            <Progress
              value={view.workouts.finished}
              max={Math.max(view.workouts.assigned, 1)}
              label="Finished of assigned"
              valueText={`${view.workouts.finished} of ${view.workouts.assigned}`}
            />
            {trendRows.length > 1 && (
              <div className="mt-4">
                <BarChart
                  height={160}
                  data={trendRows}
                  x="week"
                  series={[
                    { key: 'assigned', label: 'Assigned', color: 'var(--k-chart-6)' },
                    { key: 'finished', label: 'Finished', color: 'var(--k-chart-1)' },
                  ]}
                />
              </div>
            )}
          </ChartFrame>
        </Card>

        <Card>
          <ChartFrame
            titleAs="h2"
            title="Check-in response rate"
            summary={
              view.responseRate.denominator === 0
                ? `No check-in was due in ${period}.`
                : `${view.responseRate.numerator} of ${view.responseRate.denominator} check-ins sent (${res}%) for ${period}.`
            }
            table={{
              columns: ['Week', 'Response rate'],
              rows: trendRows.map((r) => [r.week, r.response === null ? '–' : `${r.response}%`]),
            }}
          >
            {view.responseRate.denominator === 0 ? (
              <p className="text-secondary">No check-ins due yet</p>
            ) : (
              <div className="flex items-center gap-5">
                <ProgressRing value={res} tone="cyan" />
                <div className="min-w-0 flex-1">
                  <p className="text-h3 font-semibold">
                    {view.responseRate.numerator} of {view.responseRate.denominator} sent
                  </p>
                  {trendRows.length > 1 && (
                    <AreaChart
                      height={110}
                      data={trendRows}
                      x="week"
                      unit="%"
                      series={[
                        { key: 'response', label: 'Response rate', color: 'var(--k-chart-2)' },
                      ]}
                    />
                  )}
                </div>
              </div>
            )}
          </ChartFrame>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <StatTile
            label="Due check-ins"
            value={view.dueCheckins}
            hint={`Waiting for the client, ${period}`}
            delta={
              prev
                ? {
                    value: view.dueCheckins - prev.dueCheckins,
                    label: 'vs previous period',
                    goodWhen: 'down',
                  }
                : null
            }
          />
          <StatTile
            label="Median time to follow-up"
            value={
              view.timeToFollowUp.medianHours === null
                ? '–'
                : `${view.timeToFollowUp.medianHours} h`
            }
            hint={
              view.timeToFollowUp.closed === 0
                ? 'No review items closed yet'
                : `Over ${view.timeToFollowUp.closed} review ${view.timeToFollowUp.closed === 1 ? 'item' : 'items'} you closed`
            }
            delta={
              prev &&
              prev.timeToFollowUp.medianHours !== null &&
              view.timeToFollowUp.medianHours !== null
                ? {
                    value:
                      Math.round(
                        (view.timeToFollowUp.medianHours - prev.timeToFollowUp.medianHours) * 10,
                      ) / 10,
                    label: 'vs previous period',
                    goodWhen: 'down',
                    format: (v) => `${v} h`,
                  }
                : null
            }
          />
          <StatTile
            label="Adherence"
            value={adh === null ? '–' : `${adh}%`}
            hint={`${a.completed} of ${a.eligible} due workouts`}
            delta={
              adh !== null && prevAdh !== null
                ? { value: adh - prevAdh, label: 'vs previous period', format: pts }
                : null
            }
          />
          <StatTile
            label="Response rate"
            value={res === null ? '–' : `${res}%`}
            hint={`${view.responseRate.numerator} of ${view.responseRate.denominator} check-ins`}
            delta={
              res !== null && prevRes !== null
                ? { value: res - prevRes, label: 'vs previous period', format: pts }
                : null
            }
          />
        </div>
      </div>

      <Section
        title="By client"
        description={`Active and paused clients, ${period}.`}
        className="mt-8"
      >
        <DataTable
          caption={`Adherence by client, ${period}`}
          rows={sorted}
          rowKey={(c) => c.id}
          rowHref={(c) => `/app/clients/${c.id}`}
          columns={[
            {
              key: 'name',
              header: 'Client',
              cell: (c) => c.name,
              sortHref: sortHref('name'),
              sorted: sort === 'name' ? 'ascending' : undefined,
            },
            {
              key: 'adherence',
              header: 'Adherence',
              sortHref: sortHref('adherence'),
              sorted: sort === 'adherence' ? 'ascending' : undefined,
              cell: (c) =>
                c.row?.adherencePct == null ? (
                  <span className="text-secondary">Nothing due</span>
                ) : (
                  <div className="flex min-w-32 items-center gap-2">
                    <Progress
                      size="sm"
                      value={c.row.counts.completed}
                      max={c.row.counts.eligible}
                      label={`${c.name} adherence`}
                      valueText={`${c.row.counts.completed} of ${c.row.counts.eligible}`}
                      tone={
                        c.row.adherencePct >= 80
                          ? 'success'
                          : c.row.adherencePct >= 50
                            ? 'warning'
                            : 'danger'
                      }
                    />
                    <span className="tabular w-10 text-right text-sm">
                      {Math.round(c.row.adherencePct)}%
                    </span>
                  </div>
                ),
            },
            {
              key: 'workouts',
              header: 'Workouts done',
              align: 'right',
              sortHref: sortHref('workouts'),
              sorted: sort === 'workouts' ? 'descending' : undefined,
              cell: (c) => <span className="tabular">{c.row?.counts.completed ?? 0}</span>,
            },
            {
              key: 'last',
              header: 'Last workout',
              cell: (c) => (c.row?.lastWorkout ? formatDate(c.row.lastWorkout) : '–'),
            },
          ]}
        />
      </Section>
    </>
  );
}
