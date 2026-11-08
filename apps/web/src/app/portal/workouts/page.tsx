import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DomainError,
  listSessions,
  openPauseOf,
  todayInZone,
  type SessionListScope,
} from '@repsy/core';
import { PausedBanner } from '@/components/portal/PausedBanner';
import { EmptyState } from '@/components/states/EmptyState';
import {
  ExtraWorkoutBadge,
  LoggedByCoachBadge,
  SessionStateBadge,
} from '@/components/sessions/SessionStateBadge';
import { buttonVariants } from '@/components/ui/button';
import { formatSessionDate, plural } from '@/lib/session-format';
import { cn } from '@/lib/utils';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Workouts | Repsy' };

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

const TABS: { scope: SessionListScope; label: string }[] = [
  { scope: 'upcoming', label: 'Upcoming' },
  { scope: 'past', label: 'History' },
];

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalWorkouts({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const scope: SessionListScope = first(sp.scope) === 'past' ? 'past' : 'upcoming';
  const cursor = first(sp.cursor);

  let data;
  try {
    data = await withPortalTenant(async (tx, actor) => {
      const client = await tx.client.findFirst({
        where: { id: actor.clientId },
        select: { timezone: true },
      });
      return {
        today: todayInZone(client?.timezone ?? 'UTC'),
        pause: actor.clientId ? await openPauseOf(tx, actor.clientId) : null,
        ...(await listSessions(tx, actor, { scope, cursor })),
      };
    });
  } catch (error) {
    // A malformed cursor in the URL is the only user-reachable validation failure.
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      return (
        <>
          <h1 className="mb-6 text-h1 font-semibold md:text-display">Workouts</h1>
          <EmptyState
            title="That page link is no longer valid"
            action={
              <Link href="/portal/workouts" className={buttonVariants()}>
                Back to the first page
              </Link>
            }
          />
        </>
      );
    }
    throw error;
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold md:text-display">Workouts</h1>
        <Link href="/portal/workouts/extra" className={buttonVariants({ variant: 'secondary' })}>
          Log an extra workout
        </Link>
      </div>
      {data.pause && (
        <div className="mb-6">
          <PausedBanner {...data.pause} todayLocalDate={data.today} />
        </div>
      )}
      <nav aria-label="Workout lists" className="mb-6 flex gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.scope}
            href={tab.scope === 'upcoming' ? '/portal/workouts' : '/portal/workouts?scope=past'}
            aria-current={tab.scope === scope ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: tab.scope === scope ? 'default' : 'secondary' }),
              'flex-1 md:flex-none',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {data.items.length === 0 ? (
        cursor === undefined ? (
          scope === 'upcoming' ? (
            <EmptyState
              title="No upcoming workouts"
              body="Workouts your coach schedules for you will show up here."
            />
          ) : (
            <EmptyState
              title="No workout history yet"
              body="Workouts you complete or skip will show up here."
            />
          )
        ) : (
          <EmptyState
            title="No more workouts"
            action={
              <Link href={`/portal/workouts?scope=${scope}`} className={buttonVariants()}>
                Back to the first page
              </Link>
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((s) => (
            <li key={s.id}>
              <Link
                href={`/portal/workouts/${s.id}`}
                className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-2"
              >
                <span className="text-sm text-secondary">
                  {formatSessionDate(s.scheduledLocalDate, data.today)}
                </span>
                <span className="text-lg font-semibold break-words">{s.title}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                  {plural(s.exerciseCount, 'exercise', 'exercises')}
                  <SessionStateBadge state={s.state} overdue={s.overdue} />
                  {s.loggedByCoach && <LoggedByCoachBadge />}
                  {s.extra && <ExtraWorkoutBadge />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(data.nextCursor || cursor !== undefined) && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {cursor !== undefined && (
            <Link
              href={`/portal/workouts?scope=${scope}`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              First page
            </Link>
          )}
          {data.nextCursor && (
            <Link
              href={`/portal/workouts?scope=${scope}&cursor=${encodeURIComponent(data.nextCursor)}`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              Next page
            </Link>
          )}
        </div>
      )}
    </>
  );
}
