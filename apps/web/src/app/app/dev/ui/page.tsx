import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Dumbbell, Flame, MessageSquare } from 'lucide-react';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { ConsistencyHeatmap } from '@/components/charts/ConsistencyHeatmap';
import { Donut } from '@/components/charts/Donut';
import { AreaChart, BarChart, LineChart } from '@/components/charts/Interactive';
import { STATE_COLOR } from '@/components/charts/palette';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { Sparkline } from '@/components/charts/Sparkline';
import { StackedBar } from '@/components/charts/StackedBar';
import { WeekDots } from '@/components/charts/WeekDots';
import { EmptyState } from '@/components/states/EmptyState';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ChipRow, FilterChip } from '@/components/ui/filter-chip';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { Section } from '@/components/ui/section';
import { SegmentedLinks } from '@/components/ui/segmented';
import { ChartSkeleton, RowsSkeleton, TileSkeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';

export const metadata: Metadata = { title: 'UI kit | Repsy' };

const weeks = ['7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct', '19 Oct', '26 Oct'];
const adherence = [62, 70, 68, 75, 81, 78, 84, 88];
const lift = weeks.map((w, i) => ({ week: w, top: 60 + i * 2.5, e1rm: 72 + i * 3 }));
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const clients = [
  { id: '1', name: 'Alex Rivers', status: 'Active', adherence: 92 },
  { id: '2', name: 'Sam Okafor', status: 'Active', adherence: 64 },
  { id: '3', name: 'Jordan Lee', status: 'Invited', adherence: 0 },
];

/**
 * Every component and chart with sample data, for review and screenshot tests (plan §3). Development only: the
 * route 404s in production builds.
 */
export default function UiKitPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <>
      <PageHeader
        eyebrow="Development"
        title="UI kit"
        subtitle="Every component in one place. Switch the theme to check light and dark."
        actions={<ThemeToggle />}
      />
      <div className="flex flex-col gap-10">
        <Section title="Buttons and badges">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="soft">Soft</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link button</Button>
            <Button variant="danger">Danger</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['neutral', 'brand', 'success', 'warning', 'danger', 'info', 'outline'] as const).map(
              (t) => (
                <Badge key={t} tone={t} icon={Flame}>
                  {t}
                </Badge>
              ),
            )}
          </div>
        </Section>

        <Section title="Stat tiles">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              tone="hero"
              label="Adherence this week"
              value="88%"
              spark={adherence}
              delta={{ value: 4, label: 'vs last week', format: (v) => `${v} pts` }}
            />
            <StatTile
              label="Workouts completed"
              value="23"
              delta={{ value: 3, label: 'vs last week' }}
            />
            <StatTile
              label="Check-in response"
              value="76%"
              delta={{ value: -5, label: 'vs last week', format: (v) => `${v} pts` }}
            />
            <StatTile
              label="Open review items"
              value="4"
              delta={{ value: 0, label: 'vs last week' }}
              href="/app/review"
            />
          </div>
        </Section>

        <Section title="Filters">
          <SegmentedLinks
            label="Range"
            options={[
              { href: '?r=1', label: 'This week', current: true },
              { href: '?r=4', label: '4 weeks', current: false },
              { href: '?r=12', label: '12 weeks', current: false },
            ]}
          />
          <ChipRow label="Rules">
            <FilterChip href="?" active count={4}>
              All rules
            </FilterChip>
            <FilterChip href="?a" active={false} icon={Dumbbell} count={2}>
              Missed workouts
            </FilterChip>
            <FilterChip href="?b" active={false} icon={MessageSquare} count={1}>
              Unread messages
            </FilterChip>
          </ChipRow>
        </Section>

        <Section title="People and progress">
          <Card className="flex flex-wrap items-center gap-6">
            <Avatar name="Alex Rivers" size="lg" />
            <AvatarStack
              names={clients.map((c) => c.name).concat(['Ana', 'Ben'])}
              max={3}
              label="5 clients"
            />
            <div className="w-48">
              <Progress value={3} max={8} label="Program progress" valueText="Week 3 of 8" />
            </div>
            <ProgressRing value={72} label="this week" />
            <WeekDots
              days={days.map((d, i) => ({
                label: d,
                state: (
                  ['completed', 'completed', 'missed', 'rest', 'due', 'rest', 'due'] as const
                )[i]!,
                today: i === 4,
              }))}
            />
            <Sparkline values={adherence} className="h-8 w-24" />
          </Card>
        </Section>

        <Section title="Charts">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <ChartFrame
                title="Adherence, last 8 weeks"
                summary="Adherence rose from 62% to 88% over 8 weeks."
                table={{
                  columns: ['Week', 'Adherence'],
                  rows: weeks.map((w, i) => [w, `${adherence[i]}%`]),
                }}
              >
                <AreaChart
                  data={weeks.map((w, i) => ({ week: w, adherence: adherence[i]! }))}
                  x="week"
                  series={[{ key: 'adherence', label: 'Adherence' }]}
                  unit="%"
                />
              </ChartFrame>
            </Card>
            <Card>
              <ChartFrame
                title="Bench press"
                summary="Top set rose from 60 kg to 77.5 kg; estimated 1RM from 72 kg to 93 kg."
                legend={[
                  { label: 'Top set', color: 'var(--k-chart-1)' },
                  { label: 'Estimated 1RM', color: 'var(--k-chart-2)', dashed: true },
                ]}
              >
                <LineChart
                  data={lift}
                  x="week"
                  unit="kg"
                  series={[
                    { key: 'top', label: 'Top set' },
                    { key: 'e1rm', label: 'Estimated 1RM', dashed: true },
                  ]}
                  markers={[{ x: '26 Oct', key: 'top' }]}
                />
              </ChartFrame>
            </Card>
            <Card>
              <ChartFrame
                title="This week"
                summary="12 workouts due this week: 7 completed, 1 skipped, 1 missed, 3 still due."
                legend={[
                  { label: 'Completed', color: STATE_COLOR.completed },
                  { label: 'Skipped', color: STATE_COLOR.skipped },
                  { label: 'Missed', color: STATE_COLOR.missed },
                  { label: 'Due', color: 'var(--k-input-border)' },
                ]}
              >
                <StackedBar
                  columns={days.map((d, i) => ({
                    label: d,
                    highlight: i === 3,
                    parts: [
                      { key: 'c', value: [2, 1, 2, 2, 0, 0, 0][i]!, color: STATE_COLOR.completed },
                      { key: 's', value: [0, 1, 0, 0, 0, 0, 0][i]!, color: STATE_COLOR.skipped },
                      { key: 'm', value: [0, 0, 1, 0, 0, 0, 0][i]!, color: STATE_COLOR.missed },
                      {
                        key: 'd',
                        value: [0, 0, 0, 0, 2, 1, 0][i]!,
                        color: 'var(--k-input-border)',
                      },
                    ],
                  }))}
                />
              </ChartFrame>
            </Card>
            <Card className="flex flex-col gap-4">
              <ChartFrame
                title="Adherence breakdown"
                summary="Of 20 due workouts: 15 completed, 2 skipped, 1 not finished, 2 missed."
              >
                <div className="flex items-center gap-6">
                  <Donut
                    centre="75%"
                    centreLabel="completed"
                    parts={[
                      { label: 'Completed', value: 15, color: STATE_COLOR.completed },
                      { label: 'Skipped', value: 2, color: STATE_COLOR.skipped },
                      { label: 'Not finished', value: 1, color: STATE_COLOR.notFinished },
                      { label: 'Missed', value: 2, color: STATE_COLOR.missed },
                    ]}
                  />
                  <BarChart
                    data={weeks
                      .slice(-4)
                      .map((w, i) => ({ week: w, assigned: 6 + i, finished: 5 + i }))}
                    x="week"
                    series={[
                      { key: 'assigned', label: 'Assigned' },
                      { key: 'finished', label: 'Finished' },
                    ]}
                    height={160}
                  />
                </div>
              </ChartFrame>
            </Card>
            <Card className="lg:col-span-2">
              <ChartFrame
                title="Consistency, 12 weeks"
                summary="Sample: 30 completed, 4 skipped, 3 missed scheduled days in 12 weeks."
              >
                <ConsistencyHeatmap
                  cells={Array.from({ length: 84 }, (_, i) => {
                    const d = new Date(Date.UTC(2026, 7, 10 + i)).toISOString().slice(0, 10);
                    const pick = [
                      null,
                      'completed',
                      null,
                      'completed',
                      'skipped',
                      null,
                      'missed',
                    ] as const;
                    return { date: d, state: pick[(i * 5) % 7] ?? null };
                  })}
                />
              </ChartFrame>
            </Card>
          </div>
        </Section>

        <Section title="Table">
          <DataTable
            caption="Sample clients"
            rows={clients}
            rowKey={(c) => c.id}
            rowHref={(c) => `/app/clients?q=${encodeURIComponent(c.name)}`}
            columns={[
              { key: 'name', header: 'Client', cell: (c) => c.name },
              {
                key: 'status',
                header: 'Status',
                cell: (c) => (
                  <Badge tone={c.status === 'Active' ? 'success' : 'info'}>{c.status}</Badge>
                ),
              },
              {
                key: 'adh',
                header: 'Adherence',
                align: 'right',
                cell: (c) => <span className="tabular">{c.adherence}%</span>,
              },
            ]}
          />
        </Section>

        <Section title="Empty and loading">
          <EmptyState
            title="No clients yet"
            body="Invite your first client to see them here."
            action={<Button>Add client</Button>}
          />
          <div className="grid gap-4 md:grid-cols-3">
            <TileSkeleton />
            <ChartSkeleton height={120} />
            <RowsSkeleton rows={2} />
          </div>
        </Section>
      </div>
    </>
  );
}
