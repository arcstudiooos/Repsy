import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getReviewOverview,
  listFlags,
  RULE_TEXT,
  todayInZone,
  type FlagFilter,
  type ReviewSection,
  type RuleKey,
  parseScope,
  scopeCoachIds,
  TRAINER_ROLES,
} from '@kinetic/core';
import {
  ExtraWorkoutBadge,
  LoggedByCoachBadge,
  SessionStateBadge,
} from '@/components/sessions/SessionStateBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSessionDate } from '@/lib/session-format';
import { withServerTenant } from '@/server/serverActor';
import { cn } from '@/lib/utils';
import { FlagQueue } from './FlagQueue';
import { MarkSeenButton } from './MarkSeenButton';

export const metadata: Metadata = { title: 'Review | Kinetic' };

function Section({
  id,
  title,
  description,
  empty,
  section,
  today,
  action,
}: {
  id: string;
  title: string;
  description: string;
  empty: string;
  section: ReviewSection;
  today: string;
  action?: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle as="h3" id={headingId}>
              {title} ({section.count})
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {action}
        </CardHeader>
        <CardContent>
          {section.items.length === 0 ? (
            <p className="text-secondary">{empty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider">
              {section.items.map((item) => (
                <li key={item.sessionId} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/clients/${item.clientId}`}
                      className="font-semibold break-words text-accent underline underline-offset-4"
                    >
                      {item.clientName}
                    </Link>
                    <span aria-hidden>·</span>
                    <Link
                      href={`/app/clients/${item.clientId}/sessions/${item.sessionId}`}
                      className="break-words underline underline-offset-4"
                    >
                      {item.title}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                    <span>{formatSessionDate(item.scheduledLocalDate, today)}</span>
                    <SessionStateBadge state={item.state} overdue={false} />
                    {item.loggedByCoach && <LoggedByCoachBadge />}
                    {item.extra && <ExtraWorkoutBadge />}
                    {item.formCheckCount > 0 && (
                      <span className="text-sm text-secondary">
                        {item.formCheckCount === 1
                          ? '1 form-check video'
                          : `${item.formCheckCount} form-check videos`}
                      </span>
                    )}
                    {item.readinessScore !== null && (
                      <span className="text-sm text-secondary">
                        Readiness {item.readinessScore}/100
                      </span>
                    )}
                    {item.swapCount > 0 && (
                      <span className="rounded-full bg-canvas px-2 py-0.5 text-sm text-secondary">
                        {item.swapCount === 1
                          ? '1 exercise swapped'
                          : `${item.swapCount} exercises swapped`}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {section.count > section.items.length && (
            <p className="mt-3 text-sm text-secondary">
              Showing {section.items.length} of {section.count}.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

const FILTERS: { value: FlagFilter; label: string }[] = [
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'closed', label: 'Closed' },
];
const RULES = Object.keys(RULE_TEXT) as RuleKey[];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * The review queue (S4-3): "Needs review" flags from the rules engine and follow-ups, one card per client, with
 * filters by state and rule. Below it, the Sprint 2 activity lists (new completed, due, skipped this week).
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filterParam = first(sp.filter);
  const filter: FlagFilter = FILTERS.some((f) => f.value === filterParam)
    ? (filterParam as FlagFilter)
    : 'needs_attention';
  const ruleParam = first(sp.rule);
  const rule = RULES.includes(ruleParam as RuleKey) ? (ruleParam as RuleKey) : undefined;
  const hrefFor = (f: FlagFilter, r?: RuleKey) => {
    const q = new URLSearchParams();
    if (f !== 'needs_attention') q.set('filter', f);
    if (r) q.set('rule', r);
    const qs = q.toString();
    return qs ? `/app/review?${qs}` : '/app/review';
  };
  const { review, timezone, flags, scope, team } = await withServerTenant(async (tx, actor) => {
    // PRD A12: coaches review their own clients by default (and anyone they cover for).
    const team =
      (await tx.membership.count({
        where: { status: 'active', role: { in: [...TRAINER_ROLES] } },
      })) > 1;
    const scope = team ? parseScope(actor.role, first(sp.scope)) : 'all';
    const coachUserIds = await scopeCoachIds(tx, actor, scope);
    return {
      scope,
      team,
      flags: await listFlags(tx, actor, { filter, rule, coachUserIds }),
      review: await getReviewOverview(tx, actor, { coachUserIds }),
      timezone:
        (
          await tx.organization.findFirst({
            where: { id: actor.orgId },
            select: { timezone: true },
          })
        )?.timezone ?? 'UTC',
    };
  });
  const today = todayInZone(timezone, new Date(review.generatedAt));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Review</h1>
      {team && (
        <nav aria-label="Whose clients" className="mb-4 flex gap-2">
          {(
            [
              ['mine', 'My clients'],
              ['all', 'All clients'],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={`/app/review?scope=${value}`}
              aria-current={scope === value ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-control border px-3',
                scope === value
                  ? 'border-accent bg-accent text-white'
                  : 'border-input-border bg-surface text-ink',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      <section aria-labelledby="queue-heading" className="mb-8 flex flex-col gap-4">
        <h2 id="queue-heading" className="text-lg font-semibold">
          Needs review
        </h2>
        <nav aria-label="Queue filters" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={hrefFor(f.value, rule)}
              aria-current={f.value === filter ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-control border px-3',
                f.value === filter ? 'border-accent font-semibold' : 'border-input-border',
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Filter by rule" className="flex flex-wrap gap-2 text-sm">
          <Link
            href={hrefFor(filter)}
            aria-current={!rule ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center underline-offset-4',
              !rule ? 'font-semibold' : 'underline',
            )}
          >
            All rules
          </Link>
          {RULES.map((r) => (
            <Link
              key={r}
              href={hrefFor(filter, r)}
              aria-current={r === rule ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center underline-offset-4',
                r === rule ? 'font-semibold' : 'underline',
              )}
            >
              {RULE_TEXT[r]}
            </Link>
          ))}
        </nav>
        <FlagQueue
          key={`${filter}:${rule ?? ''}:${flags.map((f) => f.id).join(',')}`}
          initial={flags}
          filter={filter}
          todayLocalDate={today}
        />
      </section>
      <h2 className="mb-4 text-lg font-semibold">Activity</h2>
      <div className="flex flex-col gap-6">
        <Section
          id="new"
          title="New completed workouts"
          description={
            review.seenAt
              ? 'Completed since you last marked the list as seen.'
              : 'Completed in the last 14 days.'
          }
          empty="No new completed workouts."
          section={review.newCompleted}
          today={today}
          action={
            review.newCompleted.count > 0 ? (
              <MarkSeenButton through={review.generatedAt} />
            ) : undefined
          }
        />
        <Section
          id="due"
          title="Due this week"
          description="Workouts not finished yet, scheduled this week."
          empty="Nothing else is due this week."
          section={review.dueThisWeek}
          today={today}
        />
        <Section
          id="skipped"
          title="Skipped this week"
          description="Workouts your clients chose to skip this week."
          empty="No skipped workouts this week."
          section={review.skippedThisWeek}
          today={today}
        />
      </div>
    </>
  );
}
