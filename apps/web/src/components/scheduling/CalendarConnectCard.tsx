'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CalendarConnectionView } from '@kinetic/core';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { formatWhen, useHydrated } from '@/components/time/LocalTime';

const NOTICE: Record<string, string> = {
  connected: 'Google Calendar connected. Upcoming bookings will appear there within a few minutes.',
  cancelled: 'Google Calendar was not connected.',
  error: 'Google Calendar could not be connected. Try again.',
  unavailable: 'Google Calendar is not set up on this server yet.',
};

/** PRD K10: connect the signed-in coach's Google calendar (two-way: push bookings, block busy times). */
export function CalendarConnectCard({
  connection,
  available,
  notice,
}: {
  connection: CalendarConnectionView | null;
  available: boolean;
  notice?: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    const res = await fetch('/api/v1/calendar/connection', {
      method: 'DELETE',
      credentials: 'same-origin',
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      toast.error('Could not disconnect. Try again.');
      return;
    }
    toast.success('Google Calendar disconnected.');
    router.replace('/app/scheduling');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Google Calendar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice && NOTICE[notice] && (
          <p role="status" className="text-sm">
            {NOTICE[notice]}
          </p>
        )}
        {!available ? (
          <p className="text-secondary">
            Google Calendar sync needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.
          </p>
        ) : connection ? (
          <>
            <p>
              Connected to <strong>{connection.accountEmail}</strong>. Bookings you coach are added
              to that calendar, and its busy times are blocked for new bookings.
            </p>
            <p className="text-sm text-secondary">
              {connection.status === 'error'
                ? `Sync stopped: ${connection.lastError ?? 'Google refused access'}. Connect again to fix it.`
                : connection.lastSyncedAt
                  ? `Last synced ${formatWhen(connection.lastSyncedAt, hydrated, { dateStyle: 'medium', timeStyle: 'short' })}.`
                  : 'Waiting for the first sync.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {connection.status === 'error' && (
                <a href="/api/v1/calendar/google/connect" className={buttonVariants()}>
                  Connect again
                </a>
              )}
              <Button variant="secondary" disabled={busy} onClick={disconnect}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-secondary">
              Connect your Google calendar so bookings show up there and clients cannot book over
              your other events.
            </p>
            <div>
              <a href="/api/v1/calendar/google/connect" className={buttonVariants()}>
                Connect Google Calendar
              </a>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
