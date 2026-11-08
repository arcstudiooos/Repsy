'use client';

import { useId, useState, type FormEvent } from 'react';
import type { ScheduledMessageView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const when = (m: Pick<ScheduledMessageView, 'localDate' | 'localTime'>) =>
  `${new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${m.localDate}T00:00:00Z`))}, ${m.localTime}`;

/** PRD H5: write now, send later at a time in the client's time zone. Coach only. */
export function ScheduledMessages({
  clientId,
  clientName,
  timezone,
  today,
  initial,
}: {
  clientId: string;
  clientName: string;
  timezone: string;
  today: string;
  initial: ScheduledMessageView[];
}) {
  const id = useId();
  const [items, setItems] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setErrors({});
    const res = await call<ScheduledMessageView>(
      'POST',
      `/api/v1/clients/${clientId}/scheduled-messages`,
      {
        body: String(data.get('body') ?? ''),
        localDate: String(data.get('localDate') ?? ''),
        localTime: String(data.get('localTime') ?? ''),
      },
    );
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors({
        body: fe.body?.[0] ?? '',
        sendAt: fe.sendAt?.[0] ?? (Object.keys(fe).length ? '' : res.message),
      });
      return;
    }
    setItems((xs) => [...xs, res.data].sort((a, b) => a.sendAt.localeCompare(b.sendAt)));
    form.reset();
    toast.success(`Scheduled for ${when(res.data)}`);
  }

  async function cancel(m: ScheduledMessageView) {
    const res = await fetch(`/api/v1/scheduled-messages/${m.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      setItems((xs) => xs.filter((x) => x.id !== m.id));
      toast.success('Scheduled message cancelled');
    } else toast.error("Couldn't cancel it. It may have been sent already.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Send later</CardTitle>
        <CardDescription>
          Times are {clientName}&apos;s local time ({timezone}).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length > 0 && (
          <ul aria-label="Scheduled messages" className="flex flex-col divide-y divide-divider">
            {items.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{when(m)}</p>
                  <p className="line-clamp-2 text-sm whitespace-pre-line text-secondary">
                    {m.body}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Cancel the message for ${when(m)}`}
                  onClick={() => void cancel(m)}
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <label htmlFor={`${id}-body`} className="text-sm font-medium">
            Message to send later
          </label>
          <textarea
            id={`${id}-body`}
            name="body"
            rows={3}
            maxLength={4000}
            aria-invalid={errors.body ? true : undefined}
            aria-describedby={errors.body ? `${id}-body-err` : undefined}
            className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
          />
          {errors.body && (
            <p id={`${id}-body-err`} className="text-sm text-danger">
              {errors.body}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-date`} className="text-sm font-medium">
                Date
              </label>
              <Input
                id={`${id}-date`}
                name="localDate"
                type="date"
                min={today}
                defaultValue={today}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-time`} className="text-sm font-medium">
                Time
              </label>
              <Input id={`${id}-time`} name="localTime" type="time" defaultValue="08:00" />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
          {errors.sendAt && (
            <p role="alert" className="text-sm text-danger">
              {errors.sendAt}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
