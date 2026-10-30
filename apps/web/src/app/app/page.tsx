import type { Metadata } from 'next';
import Link from 'next/link';
import { getReviewCounts } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Dashboard | Kinetic' };

// Access is enforced by src/proxy.ts and the membership gate in layout.tsx.
export default async function AppHome() {
  const { clientCount, review } = await withServerTenant(async (tx, actor) => ({
    clientCount: await tx.client.count(),
    review: await getReviewCounts(tx, actor),
  }));

  if (clientCount === 0) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Coach dashboard</h1>
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

  const cards = [
    { label: 'New completed workouts', count: review.newCompleted, anchor: 'new' },
    { label: 'Due this week', count: review.dueThisWeek, anchor: 'due' },
    { label: 'Skipped this week', count: review.skippedThisWeek, anchor: 'skipped' },
  ];
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Coach dashboard</h1>
      <ul className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <li key={c.anchor}>
            <Link
              href={`/app/review#${c.anchor}`}
              className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card transition-colors duration-[var(--k-motion-fast)] hover:bg-canvas sm:p-6"
            >
              <span className="text-sm text-secondary">{c.label}</span>
              <span className="text-3xl font-semibold">{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6">
        <Link href="/app/review" className="text-accent underline underline-offset-4">
          Open the review list
        </Link>
      </p>
    </>
  );
}
