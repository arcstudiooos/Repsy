import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { getPortalHome } from '@kinetic/core';
import { PausedBanner } from '@/components/portal/PausedBanner';
import { EmptyState } from '@/components/states/EmptyState';
import { LoggedByCoachBadge, SessionStateBadge } from '@/components/sessions/SessionStateBadge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSessionDate, plural, SAFETY_REMINDER } from '@/lib/session-format';
import { cn } from '@/lib/utils';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Home | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalHome() {
  const { org, home } = await withPortalTenant(async (tx, actor) => ({
    org: await tx.organization.findFirst({ where: { id: actor.orgId }, select: { name: true } }),
    home: await getPortalHome(tx, actor),
  }));
  const next = home.nextWorkout;
  const { week } = home;

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Home</h1>
      {org && <p className="mb-6 text-secondary">Coached by {org.name}</p>}
      <div className="flex flex-col gap-6">
        {home.pause && <PausedBanner resumeLocalDate={home.pause.resumeLocalDate} />}
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
              </div>
              <Link
                href={`/portal/workouts/${next.id}`}
                className={cn(buttonVariants(), 'min-h-14 w-full text-lg')}
              >
                {next.state === 'in_progress' ? 'Continue workout' : 'Start workout'}
              </Link>
            </CardContent>
          </Card>
        ) : (
          <EmptyState title="No upcoming workouts" body="Your coach will add more soon." />
        )}

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
      </div>
    </>
  );
}
