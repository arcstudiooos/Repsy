'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type DragEvent, type FormEvent } from 'react';
import type { CalendarWorkout, ClientCalendar } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { sessionStateLabel } from '@/lib/session-format';
import { cn } from '@/lib/utils';

const DAY_MS = 86_400_000;
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The days a workout on `date` may move to: from today on, and within its Monday-Sunday week for clients. */
function moveRange(date: string, today: string, limit: ClientCalendar['moveLimit']) {
  if (limit !== 'week') return { min: today, max: undefined as string | undefined };
  const dow = utc(date).getUTCDay();
  const monday = iso(utc(date).getTime() - ((dow + 6) % 7) * DAY_MS);
  const sunday = iso(utc(monday).getTime() + 6 * DAY_MS);
  return { min: monday > today ? monday : today, max: sunday };
}

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(utc(d));
const longDate = (d: string) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

const CHECKIN_LABEL = {
  open: 'Check-in due',
  sent: 'Check-in sent',
  reviewed: 'Check-in reviewed',
};

const STATE_TONE: Record<string, string> = {
  completed: 'border-l-accent',
  skipped: 'border-l-warning',
  missed: 'border-l-danger',
  incomplete: 'border-l-warning',
  in_progress: 'border-l-accent',
  scheduled: 'border-l-input-border',
};

export interface CalendarMonthProps {
  calendar: ClientCalendar;
  /** Page path the month links append `?month=` to. */
  basePath: string;
  /** Link prefix for a workout (the id is appended). */
  workoutHref: string;
  /** Where a check-in links to; a value ending in "/" gets the check-in id appended. */
  checkinHref: string;
}

/** A month of one client's plan (PRD C16). Coaches move unstarted workouts by dragging or with "Move". */
export function CalendarMonth({
  calendar,
  basePath,
  workoutHref,
  checkinHref,
}: CalendarMonthProps) {
  const router = useRouter();
  const [moving, setMoving] = useState<CalendarWorkout | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const days: string[] = [];
  for (
    let t = utc(calendar.gridStart).getTime();
    t <= utc(calendar.gridEnd).getTime();
    t += DAY_MS
  ) {
    days.push(iso(t));
  }
  const workoutsOn = (d: string) => calendar.workouts.filter((w) => w.date === d);
  const checkinsOn = (d: string) => calendar.checkins.filter((c) => c.date === d);
  const inMonth = (d: string) => d.startsWith(calendar.month);
  const agendaDays = days.filter(
    (d) => inMonth(d) && (workoutsOn(d).length > 0 || checkinsOn(d).length > 0),
  );
  const monthTitle = fmt(`${calendar.month}-01`, { month: 'long', year: 'numeric' });
  const anyMovable = calendar.workouts.some((w) => w.movable);

  async function move(w: CalendarWorkout, toLocalDate: string, shiftLater: boolean) {
    const res = await call<{ moved: number }>(
      'POST',
      `/api/v1/sessions/${encodeURIComponent(w.id)}/reschedule`,
      { toLocalDate, shiftLater },
    );
    if (!res.ok) {
      toast.error(res.fieldErrors?.toLocalDate?.[0] ?? res.message);
      return false;
    }
    toast.success(
      res.data.moved > 1
        ? `Moved ${res.data.moved} workouts.`
        : `Moved "${w.title}" to ${longDate(toLocalDate)}.`,
    );
    router.refresh();
    return true;
  }

  function onDrop(e: DragEvent, day: string) {
    e.preventDefault();
    setDropDay(null);
    const w = calendar.workouts.find((x) => x.id === dragId);
    setDragId(null);
    if (!w || w.date === day) return;
    const range = moveRange(w.date, calendar.todayLocalDate, calendar.moveLimit);
    if (day < range.min || (range.max && day > range.max)) return;
    void move(w, day, false);
  }

  const workoutChip = (w: CalendarWorkout, compact: boolean) => (
    <div
      key={w.id}
      draggable={w.movable}
      onDragStart={(e) => {
        setDragId(w.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setDragId(null)}
      className={cn(
        'rounded-control border border-l-4 border-divider bg-surface px-2 py-1',
        STATE_TONE[w.overdue && w.state === 'scheduled' ? 'missed' : w.state],
        w.movable && 'cursor-grab',
      )}
    >
      <Link
        href={`${workoutHref}${w.id}`}
        className={cn(
          'block font-medium break-words underline-offset-4 hover:underline',
          compact && 'text-sm',
        )}
      >
        {w.title}
      </Link>
      <span className="block text-sm text-secondary">{sessionStateLabel(w.state, w.overdue)}</span>
      {w.movable && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 px-2"
          onClick={() => setMoving(w)}
          aria-label={`Move ${w.title} on ${longDate(w.date)}`}
        >
          Move
        </Button>
      )}
    </div>
  );

  const checkinChip = (c: ClientCalendar['checkins'][number]) => (
    <Link
      key={c.id}
      href={checkinHref.endsWith('/') ? `${checkinHref}${c.id}` : checkinHref}
      className="block rounded-control bg-canvas px-2 py-1 text-sm underline-offset-4 hover:underline"
    >
      {CHECKIN_LABEL[c.status]}
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold" id="calendar-heading">
          {monthTitle}
        </h2>
        <nav aria-label="Months" className="flex gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={`${basePath}?month=${shiftMonth(calendar.month, -1)}`}>Previous month</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`${basePath}?month=${calendar.todayLocalDate.slice(0, 7)}`}>
              This month
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`${basePath}?month=${shiftMonth(calendar.month, 1)}`}>Next month</Link>
          </Button>
        </nav>
      </div>
      {calendar.pause && (
        <p role="status" className="rounded-card bg-canvas p-3">
          Program paused from {longDate(calendar.pause.startLocalDate)} until{' '}
          {longDate(calendar.pause.resumeLocalDate)}. Workouts can be moved again once it resumes.
        </p>
      )}
      {anyMovable && (
        <p className="text-sm text-secondary">
          {calendar.moveLimit === 'week'
            ? 'You can move a workout that has not started to another day in the same week. Your coach will see it.'
            : 'Drag a workout that has not started to another day, or use Move.'}
        </p>
      )}

      {/* Month grid from md up. */}
      <table
        className="hidden w-full table-fixed border-collapse md:table"
        aria-labelledby="calendar-heading"
      >
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th
                key={d}
                scope="col"
                className="px-2 py-1 text-left text-sm font-medium text-secondary"
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: days.length / 7 }, (_, wk) => (
            <tr key={wk}>
              {days.slice(wk * 7, wk * 7 + 7).map((d) => {
                const dragged = calendar.workouts.find((x) => x.id === dragId);
                const range = dragged
                  ? moveRange(dragged.date, calendar.todayLocalDate, calendar.moveLimit)
                  : null;
                const droppable =
                  range !== null && d >= range.min && (!range.max || d <= range.max);
                return (
                  <td
                    key={d}
                    onDragOver={(e) => {
                      if (!droppable) return;
                      e.preventDefault();
                      setDropDay(d);
                    }}
                    onDragLeave={() => setDropDay((x) => (x === d ? null : x))}
                    onDrop={(e) => onDrop(e, d)}
                    className={cn(
                      'h-28 border border-divider p-1 align-top',
                      inMonth(d) ? 'bg-surface' : 'bg-canvas',
                      dropDay === d && 'ring-2 ring-accent ring-inset',
                    )}
                  >
                    <div className="space-y-1">
                      <span
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-full text-sm',
                          d === calendar.todayLocalDate && 'bg-accent font-semibold text-white',
                          !inMonth(d) && 'text-secondary',
                        )}
                      >
                        <span aria-hidden>{Number(d.slice(8))}</span>
                        <span className="sr-only">{longDate(d)}</span>
                      </span>
                      {workoutsOn(d).map((w) => workoutChip(w, true))}
                      {checkinsOn(d).map(checkinChip)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Agenda list on small screens. */}
      <div className="md:hidden">
        {agendaDays.length === 0 ? (
          <p className="text-secondary">Nothing planned this month.</p>
        ) : (
          <ol className="space-y-3">
            {agendaDays.map((d) => (
              <li key={d} className="rounded-card bg-surface p-3 shadow-card">
                <h3 className="mb-2 font-semibold">
                  {longDate(d)}
                  {d === calendar.todayLocalDate && ' (today)'}
                </h3>
                <div className="space-y-2">
                  {workoutsOn(d).map((w) => workoutChip(w, false))}
                  {checkinsOn(d).map(checkinChip)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {moving && (
        <MoveDialog
          workout={moving}
          today={calendar.todayLocalDate}
          limit={calendar.moveLimit}
          onClose={() => setMoving(null)}
          onMove={async (to, later) => {
            if (await move(moving, to, later)) setMoving(null);
          }}
        />
      )}
    </div>
  );
}

function MoveDialog({
  workout,
  today,
  limit,
  onClose,
  onMove,
}: {
  workout: CalendarWorkout;
  today: string;
  limit: ClientCalendar['moveLimit'];
  onClose: () => void;
  onMove: (toLocalDate: string, shiftLater: boolean) => Promise<void>;
}) {
  const dateId = useId();
  const laterId = useId();
  const [date, setDate] = useState(workout.date);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const range = moveRange(workout.date, today, limit);
  const outside = date < range.min || (range.max !== undefined && date > range.max);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onMove(date, later);
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} aria-label="Move workout">
          <DialogHeader>
            <DialogTitle>Move {workout.title}</DialogTitle>
            <DialogDescription>Now on {longDate(workout.date)}.</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-4">
            <div>
              <label htmlFor={dateId} className="mb-1 block text-sm font-medium">
                New day
              </label>
              <input
                id={dateId}
                type="date"
                required
                min={range.min}
                max={range.max}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="min-h-11 w-full rounded-control border border-input-border bg-surface px-3"
              />
            </div>
            {limit === 'any' && (
              <div className="flex items-start gap-2">
                <input
                  id={laterId}
                  type="checkbox"
                  checked={later}
                  onChange={(e) => setLater(e.target.checked)}
                  className="mt-1 size-5"
                />
                <label htmlFor={laterId}>
                  Also move every later workout of this program by the same number of days
                </label>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || date === workout.date || outside}>
              {busy ? 'Moving…' : 'Move workout'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
