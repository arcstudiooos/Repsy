'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { CoverView, Role } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const SELECT =
  'block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));
const lastDay = (iso: string) => day(new Date(new Date(iso).getTime() - 1).toISOString());

/** PRD A13: a coach's clients are looked after by another coach for a date range. */
export function CoverManager({
  me,
  myRole,
  coaches,
  covers,
  today,
}: {
  me: string;
  myRole: Role;
  coaches: { userId: string; name: string }[];
  covers: CoverView[];
  today: string;
}) {
  const router = useRouter();
  const id = useId();
  const manager = myRole === 'owner' || myRole === 'admin';
  const canSet = manager || myRole === 'coach';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (coaches.length < 2) return null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    const res = await call('POST', '/api/v1/team/covers', {
      coachUserId: manager ? String(data.get('coachUserId')) : me,
      coverUserId: String(data.get('coverUserId')),
      startDate: String(data.get('startDate')),
      endDate: String(data.get('endDate')),
    });
    setBusy(false);
    if (!res.ok) {
      setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      return;
    }
    form.reset();
    toast.success('Cover set');
    router.refresh();
  }
  async function end(c: CoverView) {
    const res = await fetch(`/api/v1/team/covers/${c.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      toast.success('Cover ended');
      router.refresh();
    } else toast.error("Couldn't end it. Try again.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Cover and holidays</CardTitle>
        <CardDescription>
          While a coach is away, another coach sees their clients under My clients and in Review,
          gets their clients&apos; messages, and clients see who is covering.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {covers.length > 0 && (
          <ul aria-label="Cover" className="flex flex-col divide-y divide-divider">
            {covers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {c.coverName} covers {c.coachName}, {day(c.startsAt)} to {lastDay(c.endsAt)}
                </span>
                {(manager || c.coachUserId === me) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`End ${c.coverName}'s cover for ${c.coachName}`}
                    onClick={() => void end(c)}
                  >
                    End
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canSet && (
          <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
            {manager && (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-away`} className="text-sm font-medium">
                  Coach away
                </label>
                <select id={`${id}-away`} name="coachUserId" defaultValue={me} className={SELECT}>
                  {coaches.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-cover`} className="text-sm font-medium">
                Covered by
              </label>
              <select
                id={`${id}-cover`}
                name="coverUserId"
                defaultValue={coaches.find((c) => c.userId !== me)?.userId}
                className={SELECT}
              >
                {coaches.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-from`} className="text-sm font-medium">
                From
              </label>
              <Input
                id={`${id}-from`}
                name="startDate"
                type="date"
                min={today}
                defaultValue={today}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-to`} className="text-sm font-medium">
                Until (last day)
              </label>
              <Input id={`${id}-to`} name="endDate" type="date" min={today} />
            </div>
            <Button type="submit" disabled={busy}>
              Set cover
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
