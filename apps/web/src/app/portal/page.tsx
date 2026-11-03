import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Camera,
  GraduationCap,
  LineChart,
  Plus,
  Salad,
  ShieldCheck,
  Trophy,
  UsersRound,
  Video,
  type LucideIcon,
} from 'lucide-react';
import {
  clientAssessments,
  coverForClient,
  getPortalHome,
  listBookings,
  listSessionTypes,
  listChallenges,
  listGroups,
  listHabits,
  myCourses,
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
import { Card, CardTitle } from '@/components/ui/card';
import { formatSessionDate, plural, SAFETY_REMINDER } from '@/lib/session-format';
import { formatWhen } from '@/lib/schedule-format';
import { cn } from '@/lib/utils';
import { KeepUpcoming } from '@/portal/offline/KeepUpcoming';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Home | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalHome() {
  const {
    org,
    home,
    habits,
    cover,
    courses,
    assessmentsDue,
    inGroups,
    challenges,
    nextBooking,
    canBook,
    timezone,
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
    // PRD K10: the next booked session, and whether there is anything to book.
    nextBooking: (await listBookings(tx, actor)).find((b) => b.status === 'booked') ?? null,
    canBook: (await listSessionTypes(tx, actor)).length > 0,
    timezone:
      (await tx.client.findFirst({ where: { id: actor.clientId! }, select: { timezone: true } }))
        ?.timezone ?? 'UTC',
  }));
  const lesson = courses
    .flatMap((c) =>
      c.lessons.filter((l) => l.unlocked && !l.done).map((l) => ({ ...l, course: c.title })),
    )
    .at(0);
  const next = home.nextWorkout;
  const { week } = home;

  const todo: {
    key: string;
    icon: LucideIcon;
    eyebrow: string;
    title: string;
    href: string;
    cta: string;
  }[] = [];
  if (home.openCheckin)
    todo.push({
      key: 'checkin',
      icon: ClipboardList,
      eyebrow: 'Check-in ready',
      title: home.openCheckin.title,
      href: `/portal/check-ins/${home.openCheckin.id}`,
      cta: 'Fill in check-in',
    });
  if (assessmentsDue.length > 0)
    todo.push({
      key: 'assessment',
      icon: Camera,
      eyebrow: 'Assessment photo due',
      title: assessmentsDue.map((a) => a.title).join(', '),
      href: '/portal/progress',
      cta: 'Take the photo',
    });
  if (lesson)
    todo.push({
      key: 'lesson',
      icon: GraduationCap,
      eyebrow: `New lesson · ${lesson.course}`,
      title: lesson.title,
      href: '/portal/learn',
      cta: 'Read lesson',
    });
  if (nextBooking)
    todo.push({
      key: 'booking',
      icon: Video,
      eyebrow: 'Next session',
      title: `${nextBooking.title} · ${formatWhen(nextBooking.startsAt, timezone)}`,
      href: '/portal/sessions',
      cta: nextBooking.callLink ? 'Details and call link' : 'Details',
    });

  const explore: { label: string; hint: string; href: string; icon: LucideIcon; show: boolean }[] =
    [
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
  const weekPct = week.total > 0 ? Math.round((week.completed / week.total) * 100) : 0;

  return (
    <>
      <KeepUpcoming sessionIds={home.upcomingSessionIds} />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold md:text-3xl">Home</h1>
        {org && <p className="mt-1 text-secondary">Coached by {org.name}</p>}
      </div>
      <div className="flex flex-col gap-6">
        {home.pause && <PausedBanner {...home.pause} todayLocalDate={home.todayLocalDate} />}
        {cover && (
          <p role="status" className="rounded-card border border-border bg-surface p-4 shadow-card">
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
          <section
            aria-labelledby="next-workout"
            className="relative overflow-hidden rounded-card bg-accent p-5 text-white shadow-raised sm:p-6"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-white/10"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-4 -bottom-24 size-44 rounded-full bg-white/5"
            />
            <p className="relative text-sm font-medium text-white/85">Next workout</p>
            <h2 id="next-workout" className="relative mt-1 text-2xl font-semibold break-words">
              {next.title}
            </h2>
            <div className="relative mt-2 flex flex-wrap items-center gap-2 text-sm text-white/90">
              <span>{formatSessionDate(next.scheduledLocalDate, home.todayLocalDate)}</span>
              <span aria-hidden>·</span>
              <span>{plural(next.exerciseCount, 'exercise', 'exercises')}</span>
              <SessionStateBadge state={next.state} overdue={next.overdue} />
              {next.loggedByCoach && <LoggedByCoachBadge />}
              {next.extra && <ExtraWorkoutBadge />}
            </div>
            <Link
              href={`/portal/workouts/${next.id}`}
              className="relative mt-5 flex min-h-14 w-full items-center justify-center rounded-control bg-white text-lg font-semibold text-accent-ink shadow-sm transition-colors duration-[var(--k-motion-fast)] hover:bg-accent-soft"
            >
              {next.state === 'in_progress' || next.state === 'incomplete'
                ? 'Continue workout'
                : 'Start workout'}
            </Link>
          </section>
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

        {todo.length > 0 && (
          <section aria-labelledby="todo-heading">
            <h2 id="todo-heading" className="mb-3 text-lg font-semibold">
              Also for you
            </h2>
            <ul className="flex flex-col gap-2">
              {todo.map((t) => (
                <li
                  key={t.key}
                  className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-card"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                    <t.icon aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-secondary">{t.eyebrow}</p>
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
        {!nextBooking && canBook && (
          <p>
            <Link href="/portal/sessions" className="text-accent underline underline-offset-4">
              Book a session with your coach
            </Link>
          </p>
        )}

        {week.total > 0 && (
          <Card>
            <div className="flex items-end justify-between gap-3">
              <div>
                <CardTitle>This week</CardTitle>
                <p className="mt-1 text-secondary">
                  {week.completed} of {plural(week.total, 'workout', 'workouts')} done
                </p>
              </div>
              <p className="tabular text-3xl font-semibold text-accent-ink" aria-hidden>
                {weekPct}%
              </p>
            </div>
            <div
              role="progressbar"
              aria-label="Workouts done this week"
              aria-valuemin={0}
              aria-valuemax={week.total}
              aria-valuenow={week.completed}
              className="mt-4 flex gap-1.5"
            >
              {Array.from({ length: week.total }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-2 flex-1 rounded-full',
                    i < week.completed ? 'bg-accent' : 'bg-surface-muted',
                  )}
                />
              ))}
            </div>
            <Link
              href="/portal/workouts"
              className="mt-4 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
            >
              See all workouts
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </Card>
        )}

        <HabitChecklist view={habits} />

        <section aria-labelledby="explore-heading">
          <h2 id="explore-heading" className="mb-3 text-lg font-semibold">
            More from your coach
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {explore
              .filter((e) => e.show)
              .map((e) => (
                <li key={e.href}>
                  <Link
                    href={e.href}
                    className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-card transition-colors duration-[var(--k-motion-fast)] hover:border-accent/40 hover:bg-surface-muted/50"
                  >
                    <e.icon aria-hidden className="size-5 text-accent" />
                    <span className="text-sm leading-snug font-medium">{e.label}</span>
                    <span className="text-xs text-secondary">{e.hint}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </>
  );
}
