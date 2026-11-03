import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, readClientForSupport } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withPlatformAdmin } from '@/server/platformAdmin';
import { getServerSession } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Support | Repsy' };

/** One client's data for support, only with an active grant (each view is audited). */
export default async function SupportClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const { user } = await getServerSession();
  // Authorize before system scope opens (the layout's gate renders in parallel, so it is not relied on here).
  if (!user?.isPlatformAdmin) notFound();
  let view;
  try {
    view = await withPlatformAdmin(user, (tx, admin) => readClientForSupport(tx, admin, clientId));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'FORBIDDEN') {
      return (
        <EmptyState
          title="No active support access"
          body="Grant access for this client on the admin page first."
          action={
            <Link href="/admin" className="text-accent underline">
              Back to admin
            </Link>
          }
        />
      );
    }
    throw error;
  }
  return (
    <>
      <Link href="/admin" className="mb-4 inline-flex min-h-11 items-center text-accent underline">
        Admin
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>{view.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-secondary">Email</dt>
              <dd className="break-all">{view.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-secondary">Status · time zone</dt>
              <dd>
                {view.status} · {view.timezone}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-secondary">Workouts</dt>
              <dd>
                {view.sessions.scheduled} scheduled · {view.sessions.completed} completed ·{' '}
                {view.sessions.missed} missed
              </dd>
            </div>
            <div>
              <dt className="text-sm text-secondary">Check-ins</dt>
              <dd>
                {view.checkins.submitted} sent of {view.checkins.issued}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
