'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD L7: a private link that puts the client's workouts in their calendar app. */
export function CalendarLink({ active }: { active: boolean }) {
  const id = useId();
  const [on, setOn] = useState(active);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    const res = await call<{ url: string }>('POST', '/api/v1/me/calendar-link', {});
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    setUrl(res.data.url);
    setOn(true);
  }
  async function off() {
    setBusy(true);
    const res = await fetch('/api/v1/me/calendar-link', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't turn it off. Try again.");
    setUrl(null);
    setOn(false);
    toast.success('Calendar link turned off');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Workouts in your calendar</CardTitle>
        <CardDescription>
          Add your planned workouts to Google Calendar, Apple Calendar or Outlook with a private
          link. Only the workout names and dates are shared.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {url && (
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-url`} className="text-sm font-medium">
              Your calendar link (copy it now; it isn&apos;t shown again)
            </label>
            <Input id={`${id}-url`} readOnly value={url} onFocus={(e) => e.target.select()} />
            <p className="text-sm text-secondary">
              In your calendar app choose &quot;Add calendar from URL&quot; (or
              &quot;Subscribe&quot;) and paste it.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void make()}>
            {on ? 'Make a new link' : 'Get a calendar link'}
          </Button>
          {on && (
            <Button variant="secondary" disabled={busy} onClick={() => void off()}>
              Turn off
            </Button>
          )}
        </div>
        {on && !url && (
          <p className="text-sm text-secondary">
            A link is on. Making a new one stops the old link working.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
