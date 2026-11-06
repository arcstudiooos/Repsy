'use client';

import type { ClassView, RosterEntry } from '@kinetic/core';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/states/EmptyState';
import {
  cancelClass,
  createClass,
  loadRoster,
  markAttendance,
  setClassCapacity,
} from '@/lib/classes-api';

export interface Option {
  id: string;
  name: string;
}

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function classWhen(c: Pick<ClassView, 'startsAt' | 'endsAt'>) {
  const start = new Date(c.startsAt);
  return `${dayFmt.format(start)}, ${timeFmt.format(start)} to ${timeFmt.format(new Date(c.endsAt))}`;
}

/** PRD K12: the coach's class schedule, with a form to add a class or weekly series. */
export function ClassesBoard({
  classes,
  locations,
  coaches,
  canManage,
  now,
}: {
  classes: ClassView[];
  locations: Option[];
  coaches: Option[];
  canManage: boolean;
  /** Server render time (ISO), so render stays pure. */
  now: string;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <div>
          {adding ? (
            <NewClassForm locations={locations} coaches={coaches} onDone={() => setAdding(false)} />
          ) : (
            <Button onClick={() => setAdding(true)}>Add a class</Button>
          )}
        </div>
      )}
      {classes.length === 0 ? (
        <EmptyState
          title="No classes in the next four weeks"
          body="Add a class with a capacity. Clients book a place from their app, and join a waitlist when it is full."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {classes.map((c) => (
            <li key={c.id}>
              <ClassCard item={c} canManage={canManage} now={now} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewClassForm({
  locations,
  coaches,
  onDone,
}: {
  locations: Option[];
  coaches: Option[];
  onDone: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const local = String(form.get('startsAt') ?? '');
    const start = new Date(local);
    if (!local || Number.isNaN(start.getTime())) {
      setErrors({ startsAt: ['Pick a date and time.'] });
      return;
    }
    setBusy(true);
    const res = await createClass({
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? '') || null,
      startsAt: start.toISOString(),
      durationMinutes: Number(form.get('duration')),
      capacity: Number(form.get('capacity')),
      repeatWeeks: Number(form.get('repeat')),
      locationId: String(form.get('location') ?? '') || null,
      coachUserId: String(form.get('coach') ?? '') || null,
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast.error(res.message);
      return;
    }
    toast.success(res.data.created === 1 ? 'Class added.' : `${res.data.created} classes added.`);
    onDone();
    router.refresh();
  }

  const field = (name: string) => errors[name]?.[0];
  const selectClass =
    'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <h2 className="text-h2 font-semibold sm:col-span-2">New class</h2>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2" htmlFor={`${id}-title`}>
          Title
          <Input
            id={`${id}-title`}
            name="title"
            required
            maxLength={80}
            aria-invalid={!!field('title')}
          />
          {field('title') && <span className="text-danger">{field('title')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2" htmlFor={`${id}-desc`}>
          Description (optional)
          <Input id={`${id}-desc`} name="description" maxLength={500} />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-start`}>
          Starts
          <Input
            id={`${id}-start`}
            name="startsAt"
            type="datetime-local"
            required
            aria-invalid={!!field('startsAt')}
          />
          {field('startsAt') && <span className="text-danger">{field('startsAt')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-dur`}>
          Length (minutes)
          <Input
            id={`${id}-dur`}
            name="duration"
            type="number"
            min={15}
            max={480}
            defaultValue={60}
          />
          {field('durationMinutes') && (
            <span className="text-danger">{field('durationMinutes')}</span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-cap`}>
          Places
          <Input
            id={`${id}-cap`}
            name="capacity"
            type="number"
            min={1}
            max={500}
            defaultValue={12}
          />
          {field('capacity') && <span className="text-danger">{field('capacity')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-rep`}>
          Repeat weekly
          <select id={`${id}-rep`} name="repeat" defaultValue="1" className={selectClass}>
            <option value="1">Just this once</option>
            {[4, 8, 12, 26, 52].map((n) => (
              <option key={n} value={n}>
                For {n} weeks
              </option>
            ))}
          </select>
        </label>
        {locations.length > 0 && (
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-loc`}>
            Location
            <select id={`${id}-loc`} name="location" defaultValue="" className={selectClass}>
              <option value="">No location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {coaches.length > 1 && (
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-coach`}>
            Coach
            <select id={`${id}-coach`} name="coach" defaultValue="" className={selectClass}>
              <option value="">Me</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add class'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ClassCard({ item, canManage, now }: { item: ClassView; canManage: boolean; now: string }) {
  const router = useRouter();
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = item.startsAt <= now;

  async function toggleRoster() {
    if (open) {
      setOpen(false);
      return;
    }
    const res = await loadRoster(item.id);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setRoster(res.data);
    setOpen(true);
  }

  async function changeCapacity() {
    const raw = window.prompt('How many places?', String(item.capacity));
    if (!raw) return;
    const capacity = Number(raw);
    if (!Number.isInteger(capacity)) return;
    setBusy(true);
    const res = await setClassCapacity(item.id, capacity);
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    const moved = res.data.promotedClientIds.length;
    toast.success(moved ? `Places updated. ${moved} moved off the waitlist.` : 'Places updated.');
    router.refresh();
  }

  async function cancel(wholeSeries: boolean) {
    const ok = window.confirm(
      wholeSeries
        ? 'Cancel this class and every later class in the series? Booked clients lose their place.'
        : 'Cancel this class? Booked clients lose their place.',
    );
    if (!ok) return;
    setBusy(true);
    const res = await cancelClass(item.id, wholeSeries);
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(
      res.data.cancelled === 1 ? 'Class cancelled.' : `${res.data.cancelled} classes cancelled.`,
    );
    router.refresh();
  }

  async function mark(clientId: string, attended: boolean) {
    const res = await markAttendance(item.id, [{ clientId, attended }]);
    if (!res.ok) return toast.error(res.message);
    setRoster((r) => r?.map((e) => (e.clientId === clientId ? { ...e, attended } : e)) ?? r);
  }

  const full = item.booked >= item.capacity;
  return (
    <Card className={item.cancelled ? 'opacity-70' : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold break-words">{item.title}</h3>
          <p className="text-sm text-secondary" suppressHydrationWarning>
            {classWhen(item)}
            {item.locationName ? ` · ${item.locationName}` : ''}
            {item.coachName ? ` · ${item.coachName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.cancelled ? (
            <Badge tone="danger">Cancelled</Badge>
          ) : (
            <Badge tone={full ? 'warning' : 'success'}>
              {item.booked} of {item.capacity} booked
            </Badge>
          )}
          {item.waitlisted > 0 && <Badge tone="info">{item.waitlisted} waiting</Badge>}
        </div>
      </div>
      {canManage && !item.cancelled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={toggleRoster} aria-expanded={open}>
            {open ? 'Hide roster' : 'Roster'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={changeCapacity}>
            Change places
          </Button>
          {!started && (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(false)}>
                Cancel class
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(true)}>
                Cancel series from here
              </Button>
            </>
          )}
        </div>
      )}
      {open && roster && (
        <div className="mt-4 border-t border-border pt-4">
          {roster.length === 0 ? (
            <p className="text-sm text-secondary">No one has booked yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {roster.map((r) => (
                <li
                  key={r.enrollmentId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="min-w-0 break-words">
                    {r.clientName}
                    {r.status === 'waitlisted' && (
                      <Badge tone="info" className="ml-2">
                        Waitlist
                      </Badge>
                    )}
                  </span>
                  {started && r.status === 'booked' && (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant={r.attended === true ? 'default' : 'secondary'}
                        aria-pressed={r.attended === true}
                        onClick={() => mark(r.clientId, true)}
                      >
                        Came
                      </Button>
                      <Button
                        size="sm"
                        variant={r.attended === false ? 'default' : 'secondary'}
                        aria-pressed={r.attended === false}
                        onClick={() => mark(r.clientId, false)}
                      >
                        No-show
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
