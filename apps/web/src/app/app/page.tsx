import type { Metadata } from 'next';
import Link from 'next/link';
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
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Dashboard | Kinetic' };

const ATTENTION_SHOWN = 5;

const cardClass =
  'flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card transition-colors duration-[var(--k-motion-fast)] hover:bg-canvas sm:p-6';

// Access is enforced by src/proxy.ts and the membership gate in layout.tsx.
export default async function AppHome() {
  const { clientCount, review, flags, attention, unread, missed, toReview, setup } =
    await withServerTenant(async (tx, actor) => ({
      clientCount: await tx.client.count(),
      review: await getReviewCounts(tx, actor),
      flags: await countOpenFlags(tx, actor),
      attention: (await listFlags(tx, actor)).slice(0, ATTENTION_SHOWN),
      unread: await unreadMessageCount(tx, actor),
      missed: await countRecentMissed(tx, actor),
      toReview: await listCheckinsAwaitingReview(tx, actor, { limit: ATTENTION_SHOWN }),
      setup: await getSetupChecklist(tx, actor),
    }));

  if (clientCount === 0) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Coach dashboard</h1>
        <SetupChecklist checklist={setup} />
        <EmptyState
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

  const signals = [
    {
      label: 'Overdue check-ins',
      count: flags.byRule.checkin_overdue,
      href: '/app/review?rule=checkin_overdue',
    },
    { label: 'Missed workouts (7 days)', count: missed, href: '/app/review?rule=missed_workouts' },
    { label: 'Unread messages', count: unread, href: '/app/messages' },
    {
      label: 'Check-ins to review',
      count: toReview.total,
      href: toReview.items[0]
        ? `/app/clients/${toReview.items[0].clientId}/check-ins`
        : '/app/clients',
    },
  ];
  const cards = [
    { label: 'New completed workouts', count: review.newCompleted, anchor: 'new' },
    { label: 'Due this week', count: review.dueThisWeek, anchor: 'due' },
    { label: 'Skipped this week', count: review.skippedThisWeek, anchor: 'skipped' },
  ];
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Coach dashboard</h1>
      {!setup.dismissed && <SetupChecklist checklist={setup} />}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Needs attention ({flags.total})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {attention.length === 0 ? (
            <p className="text-secondary">Nothing needs review right now.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider">
              {attention.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium break-words">{f.clientName}</span>
                  <span aria-hidden>·</span>
                  <Link href={f.href} className="break-words underline underline-offset-4">
                    {f.title ?? f.ruleText}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/review" className="text-accent underline underline-offset-4">
            Open the review queue
          </Link>
        </CardContent>
      </Card>
      {toReview.items.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Check-ins waiting for your review ({toReview.total})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-divider">
              {toReview.items.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium break-words">{c.clientName}</span>{' '}
                    <span className="text-sm text-secondary">
                      sent{' '}
                      {new Date(c.submittedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </span>
                  <Link
                    href={`/app/clients/${c.clientId}/check-ins`}
                    className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
                    aria-label={`Review ${c.clientName}'s check-in`}
                  >
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <ul className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {signals.map((c) => (
          <li key={c.label}>
            <Link href={c.href} className={cardClass}>
              <span className="text-sm text-secondary">{c.label}</span>
              <span className="text-3xl font-semibold">{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <li key={c.anchor}>
            <Link href={`/app/review#${c.anchor}`} className={cardClass}>
              <span className="text-sm text-secondary">{c.label}</span>
              <span className="text-3xl font-semibold">{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6">
        <Link href="/app/review" className="text-accent underline underline-offset-4">
          Open the activity lists
        </Link>
      </p>
      {setup.dismissed && <SetupChecklist checklist={setup} />}
    </>
  );
}
