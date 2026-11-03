'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { firstError, send } from '@/lib/billing-api';
import { formatWhen } from '@/lib/schedule-format';

/** PRD K10: days or hours off; no slot is offered inside them. Times are entered in this browser's zone. */
export function TimeOff({
  items,
  timezone,
}: {
  items: { id: string; startsAt: string; endsAt: string; note: string | null }[];
  timezone: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const from = String(f.get('from') ?? '');
    const until = String(f.get('until') ?? '');
    if (!from || !until) return;
    setBusy(true);
    const res = await send('POST', '/api/v1/schedule/time-off', {
      startsAt: new Date(from).toISOString(),
      endsAt: new Date(until).toISOString(),
      note: String(f.get('note') ?? '') || undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Time off added');
      form.reset();
      router.refresh();
    } else toast.error(firstError(res));
  }
  async function remove(id: string) {
    const res = await send('DELETE', `/api/v1/schedule/time-off/${id}`);
    if (res.ok) router.refresh();
    else toast.error(res.message);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Time off</CardTitle>
        <CardDescription>
          Booked sessions stay booked; cancel them yourself if needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-from`} className="text-sm font-medium">
              From
            </label>
            <Input id={`${uid}-from`} name="from" type="datetime-local" required />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-until`} className="text-sm font-medium">
              Until
            </label>
            <Input id={`${uid}-until`} name="until" type="datetime-local" required />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-note`} className="text-sm font-medium">
              Note (optional)
            </label>
            <Input id={`${uid}-note`} name="note" maxLength={200} />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" disabled={busy}>
              Add time off
            </Button>
          </div>
        </form>
        {items.length > 0 && (
          <ul className="flex flex-col gap-2">
            {items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {formatWhen(t.startsAt, timezone)} to {formatWhen(t.endsAt, timezone)}
                  {t.note && ` · ${t.note}`}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void remove(t.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
