import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import {
  clientAssessments,
  coverForClient,
  getPortalHome,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSessionDate, plural, SAFETY_REMINDER } from '@/lib/session-format';
import { cn } from '@/lib/utils';
import { KeepUpcoming } from '@/portal/offline/KeepUpcoming';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Home | Repsy' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalHome() {
  const { org, home, habits, cover, courses, assessmentsDue, inGroups, challenges } =
    await withPortalTenant(async (tx, actor) => ({
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
    }));
  const lesson = courses
    .flatMap((c) =>
      c.lessons.filter((l) => l.unlocked && !l.done).map((l) => ({ ...l, course: c.title })),
    )
    .at(0);
  const next = home.nextWorkout;
  const { week } = home;

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Home</h1>
      <KeepUpcoming sessionIds={home.upcomingSessionIds} />
      {org && <p className="mb-6 text-secondary">Coached by {org.name}</p>}
      <div className="flex flex-col gap-6">
        {home.pause && <PausedBanner {...home.pause} todayLocalDate={home.todayLocalDate} />}
        {cover && (
          <p role="status" className="rounded-card bg-surface p-4 shadow-card">
            {cover.coachName} is away until{' '}
            {new Intl.DateTimeFormat('en-GB', {
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${cover.until}T00:00:00Z`))}
            . {cover.coverName} is looking after you meanwhile, and gets your messages.
          </p>
        )}
        {assessmentsDue.length > 0 && (
          <Card>
            <CardHeader>
              <CardDescription>Assessment photo due</CardDescription>
              <CardTitle className="text-xl break-words">
                {assessmentsDue.map((a) => a.title).join(', ')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/portal/progress" className={cn(buttonVariants(), 'min-h-12 w-full')}>
                Take the photo
              </Link>
            </CardContent>
          </Card>
        )}
        {lesson && (
          <Card>
            <CardHeader>
              <CardDescription>New lesson · {lesson.course}</CardDescription>
              <CardTitle className="text-xl break-words">{lesson.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/portal/learn" className={cn(buttonVariants(), 'min-h-12 w-full')}>
                Read lesson
              </Link>
            </CardContent>
          </Card>
        )}
        {home.openCheckin && (
          <Card>
            <CardHeader>
              <CardDescription>Check-in ready</CardDescription>
              <CardTitle className="text-xl break-words">{home.openCheckin.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Link
                href={`/portal/check-ins/${home.openCheckin.id}`}
                className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
              >
                Fill in check-in
              </Link>
            </CardContent>
          </Card>
        )}
        {home.showSafetyReminder && (
          <aside
            aria-label="Before you start"
            className="flex gap-3 rounded-card border border-input-border bg-surface p-4"
          >
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
            <p>{SAFETY_REMINDER}</p>
          </aside>
        )}

        {!home.hasAssignment ? (
          <EmptyState
            title="Nothing scheduled yet"
            body="Your workouts and check-ins will show up here once your coach assigns them."
          />
        ) : next ? (
          <Card>
            <CardHeader>
              <CardDescription>Next workout</CardDescription>
              <CardTitle className="text-xl break-words">{next.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-secondary">
                <span>{formatSessionDate(next.scheduledLocalDate, home.todayLocalDate)}</span>
                <span aria-hidden>·</span>
                <span>{plural(next.exerciseCount, 'exercise', 'exercises')}</span>
                <SessionStateBadge state={next.state} overdue={next.overdue} />
                {next.loggedByCoach && <LoggedByCoachBadge />}
                {next.extra && <ExtraWorkoutBadge />}
              </div>
              <Link
                href={`/portal/workouts/${next.id}`}
                className={cn(buttonVariants(), 'min-h-14 w-full text-lg')}
              >
                {next.state === 'in_progress' || next.state === 'incomplete'
                  ? 'Continue workout'
                  : 'Start workout'}
              </Link>
            </CardContent>
          </Card>
        ) : (
          <EmptyState title="No upcoming workouts" body="Your coach will add more soon." />
        )}

        <HabitChecklist view={habits} />

        {week.total > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>This week</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p>
                {week.completed} of {plural(week.total, 'workout', 'workouts')} done
              </p>
              <div
                role="progressbar"
                aria-label="Workouts done this week"
                aria-valuemin={0}
                aria-valuemax={week.total}
                aria-valuenow={week.completed}
                className="h-2 w-full overflow-hidden rounded-full bg-canvas"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round((week.completed / week.total) * 100)}%` }}
                />
              </div>
              <Link href="/portal/workouts" className="text-accent underline underline-offset-4">
                See all workouts
              </Link>
            </CardContent>
          </Card>
        )}

        <Link
          href="/portal/workouts/extra"
          className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
        >
          Log an extra workout
        </Link>
        <Link
          href="/portal/resources"
          className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
        >
          Resources from your coach
        </Link>
        {challenges > 0 && (
          <Link
            href="/portal/challenges"
            className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
          >
            Challenges
          </Link>
        )}
        {inGroups && (
          <Link
            href="/portal/groups"
            className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
          >
            Your groups
          </Link>
        )}
        {courses.length > 0 && (
          <Link
            href="/portal/learn"
            className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
          >
            Your lessons
          </Link>
        )}
        <Link
          href="/portal/calendar"
          className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
        >
          See your month on a calendar
        </Link>
        <Link
          href="/portal/progress"
          className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
        >
          See your progress and personal records
        </Link>
        <Link
          href="/portal/nutrition"
          className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-12 w-full')}
        >
          Log today&apos;s nutrition
        </Link>
      </div>
    </>
  );
}
