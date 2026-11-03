'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { SessionTypeView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { firstError, send } from '@/lib/billing-api';
import { SESSION_KIND_LABEL } from '@/lib/schedule-format';

const num = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim();
  return v === '' ? undefined : Number(v);
};

/** PRD K10, H15: what clients can book, with length, buffers, notice, cancel window and the call link. */
export function SessionTypes({ types }: { types: SessionTypeView[] }) {
  const router = useRouter();
  const uid = useId();
  const [editing, setEditing] = useState<SessionTypeView | 'new' | null>(null);
  const [kind, setKind] = useState('call');
  const [busy, setBusy] = useState(false);
  const current = editing && editing !== 'new' ? editing : null;

  function open(t: SessionTypeView | 'new') {
    setKind(t === 'new' ? 'call' : t.kind);
    setEditing(t);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      title: String(f.get('title') ?? ''),
      kind,
      durationMin: num(f, 'durationMin') ?? 0,
      bufferBeforeMin: num(f, 'bufferBeforeMin'),
      bufferAfterMin: num(f, 'bufferAfterMin'),
      minNoticeHours: num(f, 'minNoticeHours'),
      maxDaysAhead: num(f, 'maxDaysAhead'),
      cancelWindowHours: num(f, 'cancelWindowHours'),
      callLink: kind === 'in_person' ? null : String(f.get('callLink') ?? '') || null,
      location: kind === 'in_person' ? String(f.get('location') ?? '') || null : null,
      usesCredit: f.get('usesCredit') === 'on',
      active: f.get('active') === 'on',
    };
    setBusy(true);
    const res = current
      ? await send('PUT', `/api/v1/session-types/${current.id}`, body)
      : await send('POST', '/api/v1/session-types', body);
    setBusy(false);
    if (res.ok) {
      toast.success('Session saved');
      setEditing(null);
      router.refresh();
    } else toast.error(firstError(res));
  }

  const field = 'flex flex-col gap-1';
  const numberField = (
    name: string,
    label: string,
    def: number | undefined,
    min: number,
    max: number,
  ) => (
    <div className={field}>
      <label htmlFor={`${uid}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`${uid}-${name}`}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={def}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle as="h2">Sessions to book</CardTitle>
          <CardDescription>Clients book these with you from their portal.</CardDescription>
        </div>
        <Button onClick={() => open('new')}>New session</Button>
      </CardHeader>
      <CardContent>
        {types.length === 0 ? (
          <p className="text-secondary">No sessions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words">
                    {t.title}
                    {!t.active && (
                      <span className="ml-2 text-sm font-normal text-secondary">(off)</span>
                    )}
                  </p>
                  <p className="text-sm text-secondary">
                    {t.durationMin} min · {SESSION_KIND_LABEL[t.kind]}
                    {t.usesCredit && ' · uses a credit'} · {t.coachName}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Edit ${t.title}`}
                  onClick={() => open(t)}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{current ? 'Edit session' : 'New session'}</DialogTitle>
            <DialogDescription>
              Times are checked against your hours and calendar.
            </DialogDescription>
          </DialogHeader>
          <form
            key={current?.id ?? 'new'}
            onSubmit={onSubmit}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className={`${field} sm:col-span-2`}>
              <label htmlFor={`${uid}-title`} className="text-sm font-medium">
                Name
              </label>
              <Input
                id={`${uid}-title`}
                name="title"
                required
                maxLength={80}
                defaultValue={current?.title}
              />
            </div>
            <fieldset className={`${field} sm:col-span-2`}>
              <legend className="mb-1 text-sm font-medium">Kind</legend>
              <div className="flex flex-wrap gap-4">
                {Object.entries(SESSION_KIND_LABEL).map(([v, label]) => (
                  <label key={v} className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="kind"
                      value={v}
                      checked={kind === v}
                      onChange={() => setKind(v)}
                      className="size-5"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {numberField('durationMin', 'Length (minutes)', current?.durationMin ?? 45, 10, 240)}
            {numberField(
              'cancelWindowHours',
              'Clients cancel up to (hours before)',
              current?.cancelWindowHours ?? 24,
              0,
              168,
            )}
            {numberField(
              'bufferBeforeMin',
              'Buffer before (minutes)',
              current?.bufferBeforeMin ?? 0,
              0,
              120,
            )}
            {numberField(
              'bufferAfterMin',
              'Buffer after (minutes)',
              current?.bufferAfterMin ?? 15,
              0,
              120,
            )}
            {numberField(
              'minNoticeHours',
              'Minimum notice (hours)',
              current?.minNoticeHours ?? 12,
              0,
              336,
            )}
            {numberField(
              'maxDaysAhead',
              'Bookable up to (days ahead)',
              current?.maxDaysAhead ?? 30,
              1,
              180,
            )}
            {kind === 'in_person' ? (
              <div className={`${field} sm:col-span-2`}>
                <label htmlFor={`${uid}-location`} className="text-sm font-medium">
                  Where
                </label>
                <Input
                  id={`${uid}-location`}
                  name="location"
                  maxLength={200}
                  defaultValue={current?.location ?? ''}
                />
              </div>
            ) : (
              <div className={`${field} sm:col-span-2`}>
                <label htmlFor={`${uid}-link`} className="text-sm font-medium">
                  Call link (optional, https)
                </label>
                <Input
                  id={`${uid}-link`}
                  name="callLink"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  maxLength={500}
                  defaultValue={current?.callLink ?? ''}
                />
              </div>
            )}
            <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                name="usesCredit"
                defaultChecked={current?.usesCredit ?? false}
                className="size-5"
              />
              Uses a session credit (from a session pack)
            </label>
            <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                name="active"
                defaultChecked={current?.active ?? true}
                className="size-5"
              />
              Open for booking
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {current ? 'Save session' : 'Create session'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
