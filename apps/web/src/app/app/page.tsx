import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, ChevronRight, Plus, UserPlus } from 'lucide-react';
import { prisma } from '@kinetic/db';
import {
  countOpenFlags,
  countRecentMissed,
  getReviewCounts,
  getSetupChecklist,
  listCheckinsAwaitingReview,
  listFlags,
  unreadMessageCount,
} from '@kinetic/core';
import { SetupChecklist } from '@/components/onboarding/SetupChecklist';
import { Avatar } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Pill } from '@/components/ui/pill';
import { StatStrip } from '@/components/ui/stat';
import { greeting, longDay, relativeDay } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { getServerSession, withServerTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Dashboard | Repsy' };

const ATTENTION_SHOWN = 5;

const rowLink =
  'group flex min-h-14 items-center gap-3 rounded-control px-2 py-2 -mx-2 transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-muted';

// Access is enforced by src/proxy.ts and the membership gate in layout.tsx.
export default async function AppHome() {
  const { user } = await getServerSession();
  const { clientCount, review, flags, attention, unread, missed, toReview, setup, timezone } =
    await withServerTenant(async (tx, actor) => ({
      clientCount: await tx.client.count(),
      review: await getReviewCounts(tx, actor),
      flags: await countOpenFlags(tx, actor),
      attention: (await listFlags(tx, actor)).slice(0, ATTENTION_SHOWN),
      unread: await unreadMessageCount(tx, actor),
      missed: await countRecentMissed(tx, actor),
      toReview: await listCheckinsAwaitingReview(tx, actor, { limit: ATTENTION_SHOWN }),
      setup: await getSetupChecklist(tx, actor),
      timezone:
        (
          await tx.organization.findFirst({
            where: { id: actor.orgId },
            select: { timezone: true },
          })
        )?.timezone ?? 'UTC',
    }));
  const me = user
    ? await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } })
    : null;
  const firstName = me?.name?.trim().split(/\s+/)[0];
  const hello = `${greeting(timezone)}${firstName ? `, ${firstName}` : ''}.`;

  const headerActions = (
    <>
      <Link href="/app/programs" className={buttonVariants({ variant: 'secondary' })}>
        <Plus aria-hidden className="size-4" />
        New program
      </Link>
      <Link href="/app/clients" className={buttonVariants()}>
        <UserPlus aria-hidden className="size-4" />
        Add client
      </Link>
    </>
  );

  if (clientCount === 0) {
    return (
      <>
        <PageHeader
          eyebrow={longDay(timezone)}
          title="Coach dashboard"
          description={`${hello} Add your first client and this page becomes your daily to-do list.`}
          actions={headerActions}
        />
        <SetupChecklist checklist={setup} />
      </>
    );
  }

  const workToDo = flags.total + toReview.total + unread;
  const summary =
    workToDo === 0
      ? `${hello} You're all caught up.`
      : `${hello} ${flags.total} ${flags.total === 1 ? 'client needs' : 'clients need'} attention, ${toReview.total} ${toReview.total === 1 ? 'check-in is' : 'check-ins are'} waiting and ${unread} ${unread === 1 ? 'message is' : 'messages are'} unread.`;

  const signals = [
    {
      label: 'Overdue check-ins',
      value: flags.byRule.checkin_overdue,
      href: '/app/review?rule=checkin_overdue',
    },
    { label: 'Missed workouts (7 days)', value: missed, href: '/app/review?rule=missed_workouts' },
    { label: 'Unread messages', value: unread, href: '/app/messages' },
    {
      label: 'Check-ins to review',
      value: toReview.total,
      href: toReview.items[0]
        ? `/app/clients/${toReview.items[0].clientId}/check-ins`
        : '/app/clients',
    },
  ];
  const week = [
    { label: 'New completed workouts', count: review.newCompleted, anchor: 'new', tone: 'accent' },
    { label: 'Due this week', count: review.dueThisWeek, anchor: 'due', tone: 'neutral' },
    {
      label: 'Skipped this week',
      count: review.skippedThisWeek,
      anchor: 'skipped',
      tone: 'warning',
    },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow={longDay(timezone)}
        title="Coach dashboard"
        description={summary}
        actions={headerActions}
      />
      <StatStrip label="Today at a glance" items={signals} className="mb-6" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div>
                <CardTitle>Needs attention ({flags.total})</CardTitle>
                <CardDescription>Raised by your review rules. Oldest first.</CardDescription>
              </div>
              <Link
                href="/app/review"
                className="inline-flex min-h-9 shrink-0 items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
              >
                Open the review queue
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </CardHeader>
            {attention.length === 0 ? (
              <div className="flex items-center gap-3 rounded-control bg-surface-muted px-4 py-5">
                <CheckCircle2 aria-hidden className="size-6 shrink-0 text-success" />
                <div>
                  <p className="font-medium">Nothing needs review right now.</p>
                  <p className="text-sm text-secondary">
                    New flags appear here as clients miss workouts or check-ins.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-divider">
                {attention.map((f) => (
                  <li key={f.id}>
                    <Link href={f.href} className={rowLink}>
                      <Avatar name={f.clientName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{f.clientName}</span>
                        <span className="block text-sm break-words text-secondary">
                          {f.title ?? f.ruleText}
                        </span>
                      </span>
                      <span className="hidden text-sm text-secondary sm:inline">
                        {relativeDay(f.createdAt)}
                      </span>
                      <ChevronRight
                        aria-hidden
                        className="size-4 shrink-0 text-secondary transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {toReview.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Check-ins waiting for your review ({toReview.total})</CardTitle>
              </CardHeader>
              <ul className="flex flex-col divide-y divide-divider">
                {toReview.items.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <Avatar name={c.clientName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.clientName}</span>
                      <span className="block text-sm text-secondary">
                        Sent{' '}
                        {new Date(c.submittedAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    </span>
                    <Link
                      href={`/app/clients/${c.clientId}/check-ins`}
                      className={buttonVariants({ variant: 'soft', size: 'sm' })}
                      aria-label={`Review ${c.clientName}'s check-in`}
                    >
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <aside aria-label="This week" className="flex min-w-0 flex-col gap-6">
          <Card className="sm:p-5">
            <CardHeader className="mb-2">
              <CardTitle as="h2" className="text-base">
                This week
              </CardTitle>
            </CardHeader>
            <ul className="flex flex-col">
              {week.map((c) => (
                <li key={c.anchor}>
                  <Link
                    href={`/app/review#${c.anchor}`}
                    className={cn(rowLink, 'min-h-12 justify-between')}
                  >
                    <span className="text-sm text-ink">{c.label}</span>{' '}
                    <Pill tone={c.count === 0 ? 'neutral' : c.tone} className="tabular text-sm">
                      {c.count}
                    </Pill>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/app/review"
              className="mt-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
            >
              Open the activity lists
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Card>
          {!setup.dismissed && <SetupChecklist checklist={setup} compact />}
        </aside>
      </div>
      {setup.dismissed && <SetupChecklist checklist={setup} />}
    </>
  );
}
