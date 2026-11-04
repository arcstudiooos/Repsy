'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { HabitView, HabitsView } from '@kinetic/core';
import { frequencyLabel, streakLabel } from '@/components/habits/HabitChecklist';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { createClientHabit, setHabitStatusApi } from '@/lib/habit-api';
import { cn } from '@/lib/utils';

/** PRD G12: water and supplements as ordinary habits with a daily target; never doses. */
const HABIT_PRESETS = [
  { label: 'Water', title: 'Drink water', daysPerWeek: 7, target: 8, unit: 'glasses' },
  {
    label: 'Supplements',
    title: 'Take your supplements',
    daysPerWeek: 7,
    target: null,
    unit: null,
  },
  { label: 'Steps', title: 'Walk 8,000 steps', daysPerWeek: 7, target: null, unit: null },
  { label: 'Sleep', title: 'In bed by 23:00', daysPerWeek: 7, target: null, unit: null },
] as const;

const DAY_MS = 86_400_000;
const shift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const fieldClass =
  'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** 12 weeks x 7 days, oldest top-left, ending today (PRD G2). Decorative: the summary text carries the data. */
function HeatMap({ habit, today }: { habit: HabitView; today: string }) {
  const target = habit.targetCount ?? 1;
  const cells = Array.from({ length: 84 }, (_, i) => shift(today, i - 83));
  const done = cells.filter((d) => (habit.logs[d] ?? 0) >= target).length;
  return (
    <div className="flex flex-col gap-1">
      <div aria-hidden className="grid w-fit grid-flow-col grid-rows-7 gap-0.5">
        {cells.map((d) => {
          const inRange = d >= habit.startDate && (habit.endDate === null || d <= habit.endDate);
          const hit = (habit.logs[d] ?? 0) >= target;
          return (
            <span
              key={d}
              title={d}
              className={cn(
                'size-3 rounded-[2px]',
                hit ? 'bg-accent' : inRange ? 'bg-divider' : 'bg-canvas',
              )}
            />
          );
        })}
      </div>
      <p className="text-sm text-secondary">Done on {done} of the last 84 days.</p>
    </div>
  );
}

function NewHabitForm({ clientId, today }: { clientId: string; today: string }) {
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState<'habit' | 'task'>('habit');
  const [title, setTitle] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState('7');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [dueDate, setDueDate] = useState(shift(today, 7));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const err = (f: string) =>
    errors[f] ? (
      <p id={`${id}-${f}-e`} role="alert" className="text-sm text-danger">
        {errors[f]}
      </p>
    ) : null;
  const desc = (f: string) => (errors[f] ? `${id}-${f}-e` : undefined);

  return (
    <form
      noValidate
      aria-label="Assign a habit or task"
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const body =
          kind === 'task'
            ? { title, isTask: true, startDate, dueDate }
            : {
                title,
                daysPerWeek: Number(daysPerWeek),
                startDate,
                ...(target.trim() ? { targetCount: Number(target), unit: unit || null } : {}),
              };
        const res = await createClientHabit(clientId, body);
        setBusy(false);
        if (!res.ok) {
          const fe = res.fieldErrors ?? {};
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(fe)) if (v[0]) next[k] = v[0];
          if (Object.keys(next).length === 0) toast.error(res.message);
          setErrors(next);
          return;
        }
        setErrors({});
        setTitle('');
        setTarget('');
        setUnit('');
        toast.success(`${kind === 'task' ? 'Task' : 'Habit'} assigned.`);
        router.refresh();
      }}
    >
      <fieldset className="flex gap-4 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Type</legend>
        {(['habit', 'task'] as const).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name={`${id}-kind`}
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="size-5"
            />
            {k === 'habit' ? 'Habit (repeats)' : 'Task (once)'}
          </label>
        ))}
      </fieldset>
      {kind === 'habit' && (
        <div className="flex flex-col gap-1 sm:col-span-2">
          <p id={`${id}-presets`} className="text-sm font-medium">
            Quick start
          </p>
          <div role="group" aria-labelledby={`${id}-presets`} className="flex flex-wrap gap-2">
            {HABIT_PRESETS.map((p) => (
              <Button
                key={p.title}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setTitle(p.title);
                  setDaysPerWeek(String(p.daysPerWeek));
                  setTarget(p.target ? String(p.target) : '');
                  setUnit(p.unit ?? '');
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <p className="text-sm text-secondary">
            Supplements: agree what to take with your client (and their doctor). Repsy gives no
            dosing advice; the habit only tracks that they took it.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Title
        </label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={120}
          placeholder={
            kind === 'habit' ? 'e.g. Walk 8,000 steps' : 'e.g. Send a photo of your home gym'
          }
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={desc('title')}
        />
        {err('title')}
      </div>
      {kind === 'habit' ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-days`} className="text-sm font-medium">
              How often
            </label>
            <select
              id={`${id}-days`}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(e.target.value)}
              className={fieldClass}
            >
              <option value="7">Every day</option>
              {[6, 5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'day' : 'days'} a week
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-target`} className="text-sm font-medium">
                Target (optional)
              </label>
              <Input
                id={`${id}-target`}
                inputMode="numeric"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-invalid={errors.targetCount ? true : undefined}
                aria-describedby={desc('targetCount')}
              />
              {err('targetCount')}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-unit`} className="text-sm font-medium">
                Unit
              </label>
              <Input
                id={`${id}-unit`}
                value={unit}
                maxLength={20}
                placeholder="glasses"
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-due`} className="text-sm font-medium">
            Due
          </label>
          <Input
            id={`${id}-due`}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={errors.dueDate ? true : undefined}
            aria-describedby={desc('dueDate')}
          />
          {err('dueDate')}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-start`} className="text-sm font-medium">
          Starts
        </label>
        <Input
          id={`${id}-start`}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          aria-invalid={errors.startDate ? true : undefined}
          aria-describedby={desc('startDate')}
        />
        {err('startDate')}
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Assigning…' : kind === 'habit' ? 'Assign habit' : 'Assign task'}
        </Button>
      </div>
    </form>
  );
}

/** The coach's view of a client's habits and tasks (PRD G1-G3): assign, see adherence, archive. */
export function HabitsManager({ clientId, view }: { clientId: string; view: HabitsView }) {
  const router = useRouter();
  async function archive(h: HabitView) {
    const res = await setHabitStatusApi(h.id, 'archived');
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`Archived "${h.title}".`);
    router.refresh();
  }
  const all = [...view.habits, ...view.tasks];
  return (
    <div className="flex flex-col gap-6">
      {all.length === 0 ? (
        <p className="text-secondary">No habits or tasks yet. Assign the first one below.</p>
      ) : (
        <ul aria-label="Habits and tasks" className="grid gap-4 lg:grid-cols-2">
          {all.map((h) => {
            const streak = streakLabel(h);
            return (
              <li key={h.id}>
                <Card className="h-full">
                  <CardHeader className="mb-2">
                    <CardTitle as="h3" className="text-base break-words">
                      {h.title}
                    </CardTitle>
                    <CardDescription>{frequencyLabel(h)}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {h.isTask ? (
                      <p>{h.done ? 'Done' : 'Not done yet'}</p>
                    ) : (
                      <>
                        <p className="text-sm">
                          {h.doneThisWeek} this week
                          {streak && ` · ${streak}`}
                          {h.completion &&
                            ` · ${Math.round((h.completion.done / h.completion.expected) * 100)}% of the last 4 weeks (${h.completion.done} of ${h.completion.expected})`}
                        </p>
                        <HeatMap habit={h} today={view.todayLocalDate} />
                      </>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="self-start"
                      aria-label={`Archive ${h.title}`}
                      onClick={() => archive(h)}
                    >
                      Archive
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <Card>
        <CardHeader>
          <CardTitle as="h3">Assign a habit or task</CardTitle>
          <CardDescription>The client ticks it off on their portal home.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewHabitForm clientId={clientId} today={view.todayLocalDate} />
        </CardContent>
      </Card>
    </div>
  );
}
