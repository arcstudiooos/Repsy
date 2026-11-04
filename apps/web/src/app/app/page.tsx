import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Dumbbell,
  MessageSquare,
  Plus,
  UserPlus,
} from 'lucide-react';
import { prisma } from '@kinetic/db';
import {
  countOpenFlags,
  countRecentMissed,
  getAdherenceSeries,
  getAnalytics,
  getClientAdherence,
  getDailySessionStates,
  getReviewCounts,
  getSetupChecklist,
  isoWeekOf,
  listCheckinsAwaitingReview,
  listFlags,
  todayInZone,
  unreadMessageCount,
} from '@kinetic/core';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { STATE_COLOR, STATE_LABEL, type SessionStateKey } from '@/components/charts/palette';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { StackedBar } from '@/components/charts/StackedBar';
import { WeekDots } from '@/components/charts/WeekDots';
import { SetupChecklist } from '@/components/onboarding/SetupChecklist';
import { EmptyState } from '@/components/states/EmptyState';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { StatTile } from '@/components/ui/stat-tile';
import { greeting, longDay, relativeDay, weekdayShort } from '@/lib/relative-time';
import { getServerSession, withServerTenant } from '@/server/serverActor';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Dashboard | Repsy' };

const ATTENTION_SHOWN = 5;
const PULSE_SHOWN = 12;
const ACTIVITY_SHOWN = 8;
const DAY_MS = 86_400_000;
/** Read per request (a server component renders once per request). */
const requestNow = () => new Date();

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const pts = (v: number) => `${v} ${v === 1 ? 'pt' : 'pts'}`;

// Access is enforced by src/proxy.ts and the membership gate in layout.tsx.
export default async function AppHome() {
  // The clock is request data: render per request, never at build time.
  await connection();
  const now = requestNow();
  const { user } = await getServerSession();
  const data = await withServerTenant(async (tx, actor) => {
    const zone =
      (await tx.organization.findFirst({ where: { id: actor.orgId }, select: { timezone: true } }))
        ?.timezone ?? 'UTC';
    let today: string;
    try {
      today = todayInZone(zone, now);
    } catch {
      today = todayInZone('UTC', now);
    }
    const week = isoWeekOf(today);
    const lastWeekStart = new Date(new Date(`${week.start}T00:00:00Z`).getTime() - 7 * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const lastWeekEnd = new Date(new Date(`${week.start}T00:00:00Z`).getTime() - DAY_MS)
      .toISOString()
      .slice(0, 10);
    const active = await tx.client.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return {
      zone,
      clientCount: await tx.client.count(),
      review: await getReviewCounts(tx, actor),
      flags: await countOpenFlags(tx, actor),
      attention: (await listFlags(tx, actor)).slice(0, ATTENTION_SHOWN),
      unread: await unreadMessageCount(tx, actor),
      missed: await countRecentMissed(tx, actor),
      toReview: await listCheckinsAwaitingReview(tx, actor, { limit: ATTENTION_SHOWN }),
      setup: await getSetupChecklist(tx, actor),
      series: await getAdherenceSeries(tx, actor, { weeks: 8, now }),
      days: await getDailySessionStates(tx, actor, { now }),
      thisWeek: await getAnalytics(tx, actor, { from: week.start, to: week.end }, { now }),
      lastWeek: await getAnalytics(tx, actor, { from: lastWeekStart, to: lastWeekEnd }, { now }),
      active,
      pulse: await getClientAdherence(
        tx,
        actor,
        active.map((c) => c.id),
        { days: 28, now },
      ),
      recentWorkouts: await tx.workoutSession.findMany({
        where: { state: 'completed', completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: ACTIVITY_SHOWN,
        select: {
          id: true,
          clientId: true,
          completedAt: true,
          client: { select: { name: true } },
          workoutVersion: { select: { title: true } },
        },
      }),
      recentCheckins: await tx.checkin.findMany({
        where: { submittedAt: { not: null } },
        orderBy: { submittedAt: 'desc' },
        take: ACTIVITY_SHOWN,
        select: { id: true, clientId: true, submittedAt: true, client: { select: { name: true } } },
      }),
    };
  });
  const me = user
    ? await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } })
    : null;
  const firstName = me?.name?.trim().split(/\s+/)[0];
  const hello = `${greeting(data.zone, now)}${firstName ? `, ${firstName}` : ''}`;

  const actions = (
    <>
      <Link href="/app/programs" className={buttonVariants({ variant: 'secondary' })}>
        <Plus aria-hidden />
        New program
      </Link>
      <Link href="/app/clients" className={buttonVariants()}>
        <UserPlus aria-hidden />
        Add client
      </Link>
    </>
  );

  if (data.clientCount === 0) {
    return (
      <>
        <PageHeader
          eyebrow={longDay(data.zone, now)}
          title="Coach dashboard"
          subtitle={`${hello}. Add your first client and this page becomes your daily view.`}
          actions={actions}
        />
        <SetupChecklist checklist={data.setup} />
        <EmptyState
          icon={UserPlus}
          title="Nothing to review yet"
          body="Clients, check-ins and workouts will show up here as you add them."
          action={
            <Link href="/app/clients" className={buttonVariants()}>
              Add your first client
            </Link>
          }
        />
      </>
    );
  }

  const tw = data.thisWeek;
  const lw = data.lastWeek;
  const adhNow = pct(tw.adherence.completed, tw.adherence.eligible);
  const adhPrev = pct(lw.adherence.completed, lw.adherence.eligible);
  const resNow = pct(tw.responseRate.numerator, tw.responseRate.denominator);
  const resPrev = pct(lw.responseRate.numerator, lw.responseRate.denominator);
  const doneNow = data.days.reduce((s, d) => s + d.completed, 0);
  const doneWeeks = data.series.map((w) => w.completed);
  const donePrev = doneWeeks.at(-2) ?? null;

  const weekTotal = data.days.reduce(
    (s, d) => ({
      completed: s.completed + d.completed,
      skipped: s.skipped + d.skipped,
      missed: s.missed + d.missed + d.notFinished,
      due: s.due + d.due,
    }),
    { completed: 0, skipped: 0, missed: 0, due: 0 },
  );

  // Client pulse: lowest adherence (needs attention) first; clients with nothing due yet last.
  const names = new Map(data.active.map((c) => [c.id, c.name]));
  const pulse = [...data.pulse.values()]
    .sort((a, b) => (a.adherencePct ?? 101) - (b.adherencePct ?? 101))
    .slice(0, PULSE_SHOWN);

  const activity = [
    ...data.recentWorkouts.map((w) => ({
      key: `w-${w.id}`,
      at: w.completedAt!.toISOString(),
      icon: Dumbbell,
      who: w.client.name,
      what: `finished ${w.workoutVersion?.title ?? 'a workout'}`,
      href: `/app/clients/${w.clientId}/sessions/${w.id}`,
    })),
    ...data.recentCheckins.map((c) => ({
      key: `c-${c.id}`,
      at: c.submittedAt!.toISOString(),
      icon: ClipboardList,
      who: c.client.name,
      what: 'sent a check-in',
      href: `/app/clients/${c.clientId}/check-ins`,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_SHOWN);

  const weekLinks = [
    { label: 'New completed workouts', count: data.review.newCompleted, anchor: 'new' },
    { label: 'Due this week', count: data.review.dueThisWeek, anchor: 'due' },
    { label: 'Skipped this week', count: data.review.skippedThisWeek, anchor: 'skipped' },
  ];

  return (
    <>
      <PageHeader
        eyebrow={longDay(data.zone, now)}
        title="Coach dashboard"
        subtitle={`${hello}. ${data.flags.total === 0 && data.unread === 0 ? "You're all caught up." : `${data.flags.total} open review ${data.flags.total === 1 ? 'item' : 'items'} and ${data.unread} unread ${data.unread === 1 ? 'message' : 'messages'}.`}`}
        actions={actions}
      />
      {!data.setup.dismissed && <SetupChecklist checklist={data.setup} />}

      <ul
        aria-label="This week at a glance"
        className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <li>
          <StatTile
            tone="hero"
            label="Adherence this week"
            value={adhNow === null ? '–' : `${adhNow}%`}
            hint={`${tw.adherence.completed} of ${tw.adherence.eligible} due workouts done`}
            spark={data.series.map((w) => w.adherencePct)}
            delta={
              adhNow !== null && adhPrev !== null
                ? { value: adhNow - adhPrev, label: 'vs last week', format: pts }
                : null
            }
            href="/app/analytics"
          />
        </li>
        <li>
          <StatTile
            label="Workouts completed"
            value={doneNow}
            hint="This week, Monday to Sunday"
            spark={doneWeeks}
            delta={donePrev !== null ? { value: doneNow - donePrev, label: 'vs last week' } : null}
          />
        </li>
        <li>
          <StatTile
            label="Check-in response"
            value={resNow === null ? '–' : `${resNow}%`}
            hint={`${tw.responseRate.numerator} of ${tw.responseRate.denominator} check-ins sent`}
            delta={
              resNow !== null && resPrev !== null
                ? { value: resNow - resPrev, label: 'vs last week', format: pts }
                : null
            }
          />
        </li>
        <li>
          <StatTile
            label="Open review items"
            value={data.flags.total}
            hint={`${data.missed} missed workouts in 7 days · ${data.unread} unread messages`}
            href="/app/review"
          />
        </li>
      </ul>

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <ChartFrame
            titleAs="h2"
            title="This week"
            summary={`This week: ${weekTotal.completed} completed, ${weekTotal.skipped} skipped, ${weekTotal.missed} missed or not finished, ${weekTotal.due} still due.`}
            legend={[
              { label: STATE_LABEL.completed, color: STATE_COLOR.completed },
              { label: STATE_LABEL.skipped, color: STATE_COLOR.skipped },
              { label: 'Missed or not finished', color: STATE_COLOR.missed },
              { label: 'Still due', color: 'var(--k-input-border)' },
            ]}
            table={{
              columns: ['Day', 'Completed', 'Skipped', 'Missed', 'Due'],
              rows: data.days.map((d) => [
                weekdayShort(d.localDate),
                d.completed,
                d.skipped,
                d.missed + d.notFinished,
                d.due,
              ]),
            }}
          >
            <StackedBar
              columns={data.days.map((d) => ({
                label: weekdayShort(d.localDate),
                highlight: d.isToday,
                parts: [
                  { key: 'completed', value: d.completed, color: STATE_COLOR.completed },
                  { key: 'skipped', value: d.skipped, color: STATE_COLOR.skipped },
                  { key: 'missed', value: d.missed + d.notFinished, color: STATE_COLOR.missed },
                  { key: 'due', value: d.due, color: 'var(--k-input-border)' },
                ],
              }))}
            />
          </ChartFrame>
          <ul className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
            {weekLinks.map((c) => (
              <li key={c.anchor}>
                <Link
                  href={`/app/review#${c.anchor}`}
                  className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-sm transition-colors hover:bg-accent-soft"
                >
                  <span>{c.label}</span>{' '}
                  <span className="tabular text-h3 font-semibold">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-h2 font-semibold">Needs attention ({data.flags.total})</h2>
            <Link href="/app/review" className={buttonVariants({ variant: 'link' })}>
              Open the review queue
              <ArrowRight aria-hidden />
            </Link>
          </div>
          {data.attention.length === 0 ? (
            <EmptyState
              compact
              icon={CheckCircle2}
              title="All clear"
              body="Nothing needs review right now."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.attention.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-3 rounded-md border border-border p-3"
                >
                  <Avatar name={f.clientName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.clientName}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-caption text-secondary">
                      <Badge tone="warning">{f.title ?? f.ruleText}</Badge>
                      <span>raised {relativeDay(f.createdAt, now)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link
                      href={`/app/clients/${f.clientId}/messages`}
                      aria-label={`Message ${f.clientName}`}
                      className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                    >
                      <MessageSquare aria-hidden />
                    </Link>
                    <Link href={f.href} className={buttonVariants({ variant: 'soft', size: 'sm' })}>
                      Open
                      <span className="sr-only">
                        {' '}
                        {f.title ?? f.ruleText} for {f.clientName}
                      </span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.toReview.items.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="mb-2 text-h3 font-semibold">
                Check-ins waiting for your review ({data.toReview.total})
              </h3>
              <ul className="flex flex-col gap-1">
                {data.toReview.items.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1">
                    <Avatar name={c.clientName} size="xs" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{c.clientName}</span>{' '}
                      <span className="text-caption text-secondary">
                        sent {relativeDay(c.submittedAt, now)}
                      </span>
                    </span>
                    <Link
                      href={`/app/clients/${c.clientId}/check-ins`}
                      aria-label={`Review ${c.clientName}'s check-in`}
                      className={buttonVariants({ variant: 'soft', size: 'sm' })}
                    >
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section
          title="Client pulse"
          description="Active clients, lowest adherence first. Last 28 days."
          action={
            <Link href="/app/clients" className={buttonVariants({ variant: 'link' })}>
              All clients
              <ArrowRight aria-hidden />
            </Link>
          }
        >
          {pulse.length === 0 ? (
            <EmptyState
              compact
              title="No active clients"
              body="Clients show here once they accept their invite."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {pulse.map((p) => {
                const name = names.get(p.clientId) ?? 'Client';
                return (
                  <li key={p.clientId}>
                    <Link
                      href={`/app/clients/${p.clientId}`}
                      className="flex items-center gap-3 rounded-card border border-border bg-surface p-3 shadow-e1 transition-[border-color,box-shadow] hover:border-input-border hover:shadow-e2"
                    >
                      <ProgressRing value={p.adherencePct} size={52} stroke={6} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate font-medium">
                          <Avatar name={name} size="xs" />
                          {name}
                        </p>
                        <p className="mt-0.5 text-caption text-secondary">
                          {p.adherencePct === null
                            ? 'Nothing due yet'
                            : `${p.counts.completed} of ${p.counts.eligible} done`}
                        </p>
                        <WeekDots
                          size="sm"
                          className="mt-1.5"
                          days={p.week.map((d) => ({
                            label: weekdayShort(d.localDate),
                            state: (d.state ?? 'rest') as SessionStateKey | 'rest',
                          }))}
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Recent activity">
          <Card className="p-0 sm:p-0">
            {activity.length === 0 ? (
              <EmptyState
                compact
                title="No activity yet"
                body="Finished workouts and check-ins appear here."
              />
            ) : (
              <ol className="flex flex-col">
                {activity.map((a, i) => (
                  <li key={a.key} className="relative flex gap-3 px-4 py-3">
                    {i < activity.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute top-11 bottom-0 left-[1.9rem] w-px bg-border"
                      />
                    )}
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                      <a.icon aria-hidden className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <Link href={a.href} className="hover:underline">
                        <span className="font-medium">{a.who}</span> {a.what}
                      </Link>
                      <p className="text-caption text-secondary">{relativeDay(a.at, now)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </Section>
      </div>
      {data.setup.dismissed && <SetupChecklist checklist={data.setup} />}
    </>
  );
}
