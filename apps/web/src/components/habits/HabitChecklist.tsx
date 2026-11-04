'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { HabitView, HabitsView } from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { tickHabit } from '@/lib/habit-api';
import { cn } from '@/lib/utils';

export function streakLabel(h: HabitView): string | null {
  if (h.isTask || h.streak === 0) return null;
  const unit = h.daysPerWeek === 7 ? 'day' : 'week';
  return `${h.streak}-${unit} streak`;
}

export function frequencyLabel(h: HabitView): string {
  if (h.isTask) return h.dueDate ? `Due ${h.dueDate}` : 'Task';
  const freq = h.daysPerWeek === 7 ? 'Every day' : `${h.daysPerWeek} days a week`;
  return h.targetCount ? `${freq} · ${h.targetCount} ${h.unit ?? ''}`.trim() : freq;
}

const isActiveToday = (h: HabitView, today: string) =>
  h.startDate <= today && (h.endDate === null || h.endDate >= today);

/** The client's checklist for today (PRD G1, G3): tick a habit for today or mark a task done. */
export function HabitChecklist({ view }: { view: HabitsView }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, boolean>>({});
  const habits = view.habits.filter((h) => isActiveToday(h, view.todayLocalDate));
  const tasks = view.tasks.filter((t) => t.startDate <= view.todayLocalDate);
  if (habits.length === 0 && tasks.length === 0) return null;

  async function toggle(h: HabitView, done: boolean) {
    setPending(h.id);
    setState((s) => ({ ...s, [h.id]: done }));
    const res = await tickHabit(h.id, { done });
    setPending(null);
    if (!res.ok) {
      setState((s) => ({ ...s, [h.id]: !done }));
      toast.error(res.message);
      return;
    }
    router.refresh();
  }

  const item = (h: HabitView) => {
    const done = state[h.id] ?? (h.isTask ? h.done : h.doneToday);
    const streak = streakLabel(h);
    return (
      <li key={h.id} className="flex items-center gap-3 py-2">
        <button
          type="button"
          aria-pressed={done}
          disabled={pending === h.id}
          onClick={() => toggle(h, !done)}
          className={cn(
            'flex min-h-11 flex-1 items-center gap-3 rounded-control px-2 text-left hover:bg-surface-2',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full border-2',
              done ? 'border-accent bg-accent-fill text-on-accent' : 'border-input-border',
            )}
          >
            {done && <Check className="size-4" />}
          </span>
          <span className="flex flex-col">
            <span className={cn('font-medium break-words', done && 'text-secondary line-through')}>
              {h.title}
            </span>
            <span className="text-sm text-secondary">
              {frequencyLabel(h)}
              {streak && ` · ${streak}`}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s habits</CardTitle>
        <CardDescription>Tap to tick one off. Set by your coach.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {habits.length > 0 && (
          <ul aria-label="Habits" className="flex flex-col divide-y divide-divider">
            {habits.map(item)}
          </ul>
        )}
        {tasks.length > 0 && (
          <>
            <h3 className="mt-2 text-sm font-semibold">Tasks</h3>
            <ul aria-label="Tasks" className="flex flex-col divide-y divide-divider">
              {tasks.map(item)}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
