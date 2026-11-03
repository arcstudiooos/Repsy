'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CalendarConnectionView, CalendarProvider } from '@kinetic/core';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { send } from '@/lib/billing-api';

const NAME: Record<CalendarProvider, string> = {
  google: 'Google Calendar',
  outlook: 'Outlook',
  fake: 'Test calendar',
};

/** D-013 #11: bookings go to the coach's calendar; their busy times hide clashing slots. */
export function CalendarCard({
  connection,
  providers,
}: {
  connection: CalendarConnectionView | null;
  providers: CalendarProvider[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function disconnect() {
    setBusy(true);
    const res = await send('DELETE', '/api/v1/calendar/connection');
    setBusy(false);
    if (res.ok) {
      toast.success('Calendar disconnected');
      router.refresh();
    } else toast.error(res.message);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Your calendar</CardTitle>
        <CardDescription>
          Sessions appear in your calendar, and times you&apos;re busy there aren&apos;t offered.
          Only busy times are read, never what your events are.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {connection ? (
          <>
            <p>
              Connected to <strong>{NAME[connection.provider]}</strong>
              {connection.accountEmail && ` (${connection.accountEmail})`}.
            </p>
            {connection.status === 'error' && (
              <p role="alert" className="text-danger">
                The calendar stopped accepting Repsy. Connect it again.
              </p>
            )}
            <div>
              <Button variant="secondary" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          </>
        ) : providers.length === 0 ? (
          <p className="text-secondary">Calendar sync isn&apos;t set up on this site yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <a
                key={p}
                href={`/api/v1/calendar/connect/${p}`}
                className={buttonVariants({ variant: 'secondary' })}
              >
                Connect {NAME[p]}
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
