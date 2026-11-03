'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { AvailabilityWindow } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useTimezones } from '@/components/settings/form';
import { firstError, send } from '@/lib/billing-api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** PRD K10 (D-013 #11): weekly hours, as wall-clock times in the coach's zone. */
export function WeeklyHours({
  timezone,
  windows,
}: {
  timezone: string;
  windows: AvailabilityWindow[];
}) {
  const router = useRouter();
  const uid = useId();
  const zones = useTimezones();
  const [tz, setTz] = useState(timezone);
  const [rows, setRows] = useState<AvailabilityWindow[]>(windows);
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<AvailabilityWindow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    const res = await send('PUT', '/api/v1/schedule/availability', { timezone: tz, windows: rows });
    setBusy(false);
    if (res.ok) {
      toast.success('Hours saved');
      router.refresh();
    } else toast.error(firstError(res));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Weekly hours</CardTitle>
        <CardDescription>
          When clients can book you. Time off and your calendar come off these.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-tz`} className="text-sm font-medium">
            Time zone
          </label>
          <Input
            id={`${uid}-tz`}
            list={`${uid}-zones`}
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            className="max-w-sm"
          />
          <datalist id={`${uid}-zones`}>
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>
        {rows.length === 0 && <p className="text-secondary">No hours yet: nobody can book you.</p>}
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <select
                aria-label={`Day for range ${i + 1}`}
                value={r.weekday}
                onChange={(e) => update(i, { weekday: Number(e.target.value) })}
                className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
              >
                {DAYS.map((d, k) => (
                  <option key={d} value={k + 1}>
                    {d}
                  </option>
                ))}
              </select>
              <Input
                type="time"
                aria-label={`From, range ${i + 1}`}
                value={r.start}
                onChange={(e) => update(i, { start: e.target.value })}
                className="w-32"
              />
              <span aria-hidden className="py-2">
                to
              </span>
              <Input
                type="time"
                aria-label={`Until, range ${i + 1}`}
                value={r.end}
                onChange={(e) => update(i, { end: e.target.value })}
                className="w-32"
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove range ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setRows([
                ...rows,
                {
                  weekday: rows.at(-1) ? Math.min(7, rows.at(-1)!.weekday + 1) : 1,
                  start: '09:00',
                  end: '17:00',
                },
              ])
            }
          >
            Add hours
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            Save hours
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
