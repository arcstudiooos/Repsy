import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BookOpen,
  CalendarDays,
  Camera,
  ClipboardList,
  GraduationCap,
  LineChart,
  Play,
  Plus,
  Salad,
  ShieldCheck,
  Trophy,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import {
  clientAssessments,
  coverForClient,
  getPortalHome,
  listChallenges,
  listGroups,
  listHabits,
  myCourses,
  getClientConsistency,
  getPersonalRecords,
  getStreak,
} from '@kinetic/core';
import { HabitChecklist } from '@/components/habits/HabitChecklist';
import { PausedBanner } from '@/components/portal/PausedBanner';
import { EmptyState } from '@/components/states/EmptyState';
import {
  ExtraWorkoutBadge,
  LoggedByCoachBadge,
  SessionStateBadge,
} from '@/components/sessions/SessionStateBadge';
import { buttonVariants } from '@/components/ui/button';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { WeekDots } from '@/components/charts/WeekDots';
import type { SessionStateKey } from '@/components/charts/palette';
import { Card } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { dayMonth, weekdayShort } from '@/lib/relative-time';
import { formatSessionDate, plural, SAFETY_REMINDER } from '@/lib/session-format';
import { cn } from '@/lib/utils';
import { KeepUpcoming } from '@/portal/offline/KeepUpcoming';
import { withPortalTenant } from '@/server/serverActor';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Home | Repsy' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
/** Read per request (a server component renders once per request). */
const requestNow = () => new Date();

export default async function PortalHome() {
  // The clock is request data: render per request, never at build time.
  await connection();
  const now = requestNow();
  const {
    org,
    home,
    habits,
    cover,
    courses,
    assessmentsDue,
    inGroups,
    challenges,
    weekCells,
    streak,
    prs,
    preview,
  } = await withPortalTenant(async (tx, actor) => ({
    org: await tx.organization.findFirst({ where: { id: actor.orgId }, select: { name: true } }),
    home: await getPortalHome(tx, actor),
    habits: await listHabits(tx, actor, actor.clientId as string),
    // PRD A13: who is covering while the coach is away.
    cover: await coverForClient(tx, actor.clientId as string),
    // PRD G4: the next open lesson not done yet.
    courses: await myCourses(tx, actor),
    // PRD E5: assessment photos due now.
    assessmentsDue: (await clientAssessments(tx, actor)).filter((a) => a.due),
    // PRD H7, H8.
    inGroups: (await listGroups(tx, actor)).length > 0,
    // PRD H9: challenges on now or coming up.
    challenges: (await listChallenges(tx, actor)).filter((c) => c.status !== 'ended').length,
    // This ISO week, one cell per day, for the week dots.
    weekCells: await getClientConsistency(tx, actor, actor.clientId as string, { weeks: 1, now }),
    streak: await getStreak(tx, actor, actor.clientId as string, { now }),
    // Personal records set in the last 30 days (best estimated 1RM).
    prs: (await getPersonalRecords(tx, actor, actor.clientId as string))
      .filter(
        (r) =>
          r.estimatedOneRepMax &&
          Date.parse(r.estimatedOneRepMax.localDate) >= now.getTime() - 30 * 86_400_000,
      )
      .sort((a, b) =>
        b.estimatedOneRepMax!.localDate.localeCompare(a.estimatedOneRepMax!.localDate),
      )
      .slice(0, 3),
    // The next workout's first exercises, for the hero preview.
    preview: await (async () => {
      const h = await getPortalHome(tx, actor);
      const id = h.nextWorkout?.id;
      if (!id) return [];
      const s = await tx.workoutSession.findFirst({
        where: { id },
        select: { workoutVersionId: true },
      });
      if (!s?.workoutVersionId) return [];
      const rows = await tx.workoutVersionExercise.findMany({
        where: { workoutVersionId: s.workoutVersionId },
        orderBy: { position: 'asc' },
        take: 4,
        select: { exercise: { select: { name: true } } },
      });
      return rows.map((r) => r.exercise.name);
    })().catch(() => [] as string[]),
  }));
  const lesson = courses
    .flatMap((c) =>
      c.lessons.filter((l) => l.unlocked && !l.done).map((l) => ({ ...l, course: c.title })),
    )
    .at(0);
  const next = home.nextWorkout;

  const weekPct =
    home.week.total > 0 ? Math.round((home.week.completed / home.week.total) * 100) : null;
  const explore: Array<{
    label: string;
    hint: string;
    href: string;
    icon: LucideIcon;
    show: boolean;
  }> = [
    {
      label: 'Log an extra workout',
      hint: 'Anything you did off-plan',
      href: '/portal/workouts/extra',
      icon: Plus,
      show: true,
    },
    {
      label: 'See your progress and personal records',
      hint: 'Lifts, body and photos',
      href: '/portal/progress',
      icon: LineChart,
      show: true,
    },
    {
      label: "Log today's nutrition",
      hint: 'Meals and targets',
      href: '/portal/nutrition',
      icon: Salad,
      show: true,
    },
    {
      label: 'See your month on a calendar',
      hint: 'Workouts and check-ins',
      href: '/portal/calendar',
      icon: CalendarDays,
      show: true,
    },
    {
      label: 'Resources from your coach',
      hint: 'Guides and videos',
      href: '/portal/resources',
      icon: BookOpen,
      show: true,
    },
    {
      label: 'Your lessons',
      hint: 'Courses from your coach',
      href: '/portal/learn',
      icon: GraduationCap,
      show: courses.length > 0,
    },
    {
      label: 'Challenges',
      hint: 'On now or coming up',
      href: '/portal/challenges',
      icon: Trophy,
      show: challenges > 0,
    },
    {
      label: 'Your groups',
      hint: 'Train alongside others',
      href: '/portal/groups',
      icon: UsersRound,
      show: inGroups,
    },
  ];
  const todo = [
    home.openCheckin && {
      key: 'checkin',
      icon: ClipboardList,
      eyebrow: 'Check-in ready',
      title: home.openCheckin.title,
      href: `/portal/check-ins/${home.openCheckin.id}`,
      cta: 'Fill in check-in',
    },
    assessmentsDue.length > 0 && {
      key: 'assessment',
      icon: Camera,
      eyebrow: 'Assessment photo due',
      title: assessmentsDue.map((a) => a.title).join(', '),
      href: '/portal/progress',
      cta: 'Take the photo',
    },
    lesson && {
      key: 'lesson',
      icon: GraduationCap,
      eyebrow: `New lesson · ${lesson.course}`,
      title: lesson.title,
      href: '/portal/learn',
      cta: 'Read lesson',
    },
  ].filter(Boolean) as Array<{
    key: string;
    icon: LucideIcon;
    eyebrow: string;
    title: string;
    href: string;
    cta: string;
  }>;

  return (
    <>
      <KeepUpcoming sessionIds={home.upcomingSessionIds} />
      <div className="mb-6">
        <h1 className="text-h1 font-semibold">Home</h1>
        {org && <p className="mt-1 text-secondary">Coached by {org.name}</p>}
      </div>
      <div className="flex flex-col gap-6">
        {home.pause && <PausedBanner {...home.pause} todayLocalDate={home.todayLocalDate} />}
        {cover && (
          <p role="status" className="rounded-card border border-border bg-surface p-4 shadow-e1">
            {cover.coachName} is away until{' '}
            {new Intl.DateTimeFormat('en-GB', {
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${cover.until}T00:00:00Z`))}
            . {cover.coverName} is looking after you meanwhile, and gets your messages.
          </p>
        )}

        {!home.hasAssignment ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled yet"
            body="Your workouts and check-ins will show up here once your coach assigns them."
          />
        ) : next ? (
          <Card variant="hero" className="relative overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-ember/20 blur-2xl"
            />
            <p className="label-micro relative text-cyan">Next workout</p>
            <h2 className="relative mt-1 text-h1 font-semibold break-words">{next.title}</h2>
            <div className="relative mt-2 flex flex-wrap items-center gap-2 text-sm text-on-midnight">
              <span>{formatSessionDate(next.scheduledLocalDate, home.todayLocalDate)}</span>
              <span aria-hidden>·</span>
              <span>{plural(next.exerciseCount, 'exercise', 'exercises')}</span>
              <SessionStateBadge state={next.state} overdue={next.overdue} />
              {next.loggedByCoach && <LoggedByCoachBadge />}
              {next.extra && <ExtraWorkoutBadge />}
            </div>
            {preview.length > 0 && (
              <ul
                aria-label="First exercises"
                className="relative mt-4 flex flex-col gap-1.5 text-sm text-on-midnight-muted"
              >
                {preview.map((name, i) => (
                  <li key={`${name}-${i}`} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="tabular flex size-5 items-center justify-center rounded-full bg-midnight-2 text-micro text-on-midnight"
                    >
                      {i + 1}
                    </span>
                    {name}
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/portal/workouts/${next.id}`}
              className="relative mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-accent-fill text-lg font-semibold text-on-accent shadow-e1 transition-colors hover:bg-accent-hover"
            >
              <Play aria-hidden className="size-5" />
              {next.state === 'in_progress' || next.state === 'incomplete'
                ? 'Continue workout'
                : 'Start workout'}
            </Link>
          </Card>
        ) : (
          <EmptyState title="No upcoming workouts" body="Your coach will add more soon." />
        )}

        {home.showSafetyReminder && (
          <aside
            aria-label="Before you start"
            className="flex gap-3 rounded-card border border-border bg-surface p-4 text-sm"
          >
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
            <p>{SAFETY_REMINDER}</p>
          </aside>
        )}

        {home.week.total > 0 && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card className="flex items-center gap-5">
              <ProgressRing value={weekPct} size={92} stroke={10} />
              <div className="min-w-0 flex-1">
                <h2 className="text-h3 font-semibold">This week</h2>
                <p className="mt-0.5 text-secondary">
                  {home.week.completed} of {plural(home.week.total, 'workout', 'workouts')} done
                </p>
                <div
                  role="progressbar"
                  aria-label="Workouts done this week"
                  aria-valuemin={0}
                  aria-valuemax={home.week.total}
                  aria-valuenow={home.week.completed}
                  className="mt-3"
                >
                  <WeekDots
                    days={weekCells.map((d) => ({
                      label: weekdayShort(d.localDate),
                      state: (d.state ?? 'rest') as SessionStateKey | 'rest',
                      today: d.localDate === home.todayLocalDate,
                    }))}
                  />
                </div>
                <Link
                  href="/portal/workouts"
                  className={cn(buttonVariants({ variant: 'link' }), 'mt-3')}
                >
                  See all workouts
                </Link>
              </div>
            </Card>
            <StatTile
              label="Streak"
              value={streak}
              hint={`${streak === 1 ? 'workout' : 'workouts'} completed in a row`}
            />
          </div>
        )}

        {todo.length > 0 && (
          <section aria-labelledby="todo-heading" className="flex flex-col gap-3">
            <h2 id="todo-heading" className="text-h2 font-semibold">
              Also for you
            </h2>
            <ul className="flex flex-col gap-2">
              {todo.map((t) => (
                <li
                  key={t.key}
                  className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-e1"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                    <t.icon aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-caption text-secondary">{t.eyebrow}</p>
                    <p className="font-medium break-words">{t.title}</p>
                  </div>
                  <Link
                    href={t.href}
                    className={cn(buttonVariants({ variant: 'soft' }), 'w-full sm:w-auto')}
                  >
                    {t.cta}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {prs.length > 0 && (
          <section aria-labelledby="prs-heading" className="flex flex-col gap-3">
            <h2 id="prs-heading" className="text-h2 font-semibold">
              Recent personal records
            </h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {prs.map((r) => (
                <li
                  key={r.exerciseId}
                  className="rounded-card border border-border bg-surface p-4 shadow-e1"
                >
                  <p className="flex items-center gap-1.5 text-caption font-medium text-cyan-strong">
                    <Trophy aria-hidden className="size-3.5" />
                    New best
                  </p>
                  <p className="mt-1 font-medium break-words">{r.name}</p>
                  <p className="tabular mt-1 text-h2 font-semibold">
                    {Math.round(r.estimatedOneRepMax!.valueKg)} kg
                  </p>
                  <p className="text-caption text-secondary">
                    Estimated 1RM · {dayMonth(r.estimatedOneRepMax!.localDate)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <HabitChecklist view={habits} />

        <section aria-labelledby="explore-heading" className="flex flex-col gap-3">
          <h2 id="explore-heading" className="text-h2 font-semibold">
            More from your coach
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {explore
              .filter((e) => e.show)
              .map((e) => (
                <li key={e.href}>
                  <Link
                    href={e.href}
                    className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-e1 transition-[border-color,box-shadow] hover:border-input-border hover:shadow-e2"
                  >
                    <e.icon aria-hidden className="size-5 text-accent" />
                    <span className="text-sm leading-snug font-medium">{e.label}</span>
                    <span className="text-caption text-secondary">{e.hint}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </>
  );
}
