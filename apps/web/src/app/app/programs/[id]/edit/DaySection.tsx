'use client';

import { useId, useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import type { ExerciseView } from '@repsy/core';
import type { Units } from '@repsy/core/units';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { SELECT_CLASS } from '../../../exercises/labels';
import { MoveButtons, TextField, useError, useMoveFocus, type MoveDirection } from './EditorFields';
import { ExerciseCard } from './ExerciseCard';
import { ExercisePicker } from './ExercisePicker';
import { defaultSet, type EditorValues, NO_BLOCK } from './editorSchema';

export interface Slot {
  week: number;
  day: number;
}

/** The name a day goes by in labels and dialogs: its title, or its position while the title is blank. */
export const dayName = (title: string | undefined, day: number) =>
  title?.trim() || `Day ${day + 1}`;

/**
 * "Copy workout to…": pick a target week and day, then confirm "Replace {title}?" (the target's title, notes and
 * exercises are replaced by a copy of this day's).
 */
function CopyWorkoutDialog({
  source,
  sourceName,
  onCopy,
}: {
  source: Slot;
  sourceName: string;
  onCopy: (target: Slot) => void;
}) {
  const { getValues } = useFormContext<EditorValues>();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Slot>({ week: 0, day: 0 });
  const [confirming, setConfirming] = useState(false);
  const weekId = useId();
  const dayId = useId();
  // Read when the dialog renders: the dialog is open only briefly and the form doesn't change meanwhile.
  const weeks = open ? getValues('weeks') : [];
  const isSource = (s: Slot) => s.week === source.week && s.day === source.day;
  const daysIn = (w: number) => weeks[w]?.days ?? [];
  /** The first slot of week `w` other than the source (null when the source is that week's only day). */
  const firstTarget = (w: number): Slot | null => {
    const d = daysIn(w).findIndex((_, i) => !isSource({ week: w, day: i }));
    return d === -1 ? null : { week: w, day: d };
  };
  const targetName = dayName(weeks[target.week]?.days[target.day]?.title, target.day);
  const totalDays = getValues('weeks').reduce((n, w) => n + w.days.length, 0);

  function start(next: boolean) {
    if (next) {
      const all = getValues('weeks');
      const sameWeek = all[source.week]?.days.findIndex((_, i) => i !== source.day) ?? -1;
      setTarget(
        sameWeek !== -1
          ? { week: source.week, day: sameWeek }
          : { week: source.week === 0 ? 1 : 0, day: 0 },
      );
      setConfirming(false);
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={start}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm" disabled={totalDays < 2}>
          Copy workout to…
        </Button>
      </DialogTrigger>
      <DialogContent>
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle>Replace {targetName}?</DialogTitle>
              <DialogDescription>
                Week {target.week + 1}, day {target.day + 1} gets a copy of {sourceName}: its title,
                notes and exercises are replaced.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  onCopy(target);
                  setOpen(false);
                }}
              >
                Replace
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy workout to…</DialogTitle>
              <DialogDescription>
                Copy {sourceName} over another day of this program.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={weekId} className="text-sm font-medium">
                  Week
                </label>
                <select
                  id={weekId}
                  value={String(target.week)}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    const keep = { week: w, day: target.day };
                    setTarget(
                      target.day < daysIn(w).length && !isSource(keep)
                        ? keep
                        : (firstTarget(w) ?? keep),
                    );
                  }}
                  className={SELECT_CLASS}
                >
                  {weeks.map((_, w) =>
                    firstTarget(w) ? (
                      <option key={w} value={String(w)}>
                        Week {w + 1}
                      </option>
                    ) : null,
                  )}
                </select>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={dayId} className="text-sm font-medium">
                  Day
                </label>
                <select
                  id={dayId}
                  value={String(target.day)}
                  onChange={(e) => setTarget({ week: target.week, day: Number(e.target.value) })}
                  className={SELECT_CLASS}
                >
                  {daysIn(target.week).map((d, i) =>
                    isSource({ week: target.week, day: i }) ? null : (
                      <option key={i} value={String(i)}>
                        Day {i + 1} · {dayName(d.title, i)}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => setConfirming(true)}>
                Copy
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One training day of a week: title, notes, its exercises, and move/copy controls. */
export function DaySection({
  week,
  day,
  dayCount,
  units,
  onMove,
  moveRef,
  onCopy,
}: {
  week: number;
  day: number;
  dayCount: number;
  units: Units;
  onMove: (dir: MoveDirection) => void;
  moveRef: (dir: MoveDirection) => (el: HTMLButtonElement | null) => void;
  onCopy: (target: Slot) => void;
}) {
  const { control } = useFormContext<EditorValues>();
  const base = `weeks.${week}.days.${day}` as const;
  const exercises = useFieldArray({ control, name: `${base}.exercises` });
  const values = useWatch({ control, name: base });
  const headingId = useId();
  const exercisesError = useError(`${base}.exercises`);
  const focus = useMoveFocus();
  const name = dayName(values?.title, day);

  function moveExercise(i: number, key: string, dir: MoveDirection) {
    focus.moved(key, dir);
    exercises.move(i, dir === 'up' ? i - 1 : i + 1);
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-1">
        <h3 id={headingId} className="min-w-0 flex-1 text-lg font-semibold">
          Day {day + 1}
        </h3>
        <MoveButtons name={name} index={day} count={dayCount} onMove={onMove} buttonRef={moveRef} />
        <CopyWorkoutDialog source={{ week, day }} sourceName={name} onCopy={onCopy} />
      </div>
      <TextField path={`${base}.title`} label="Day title" maxLength={120} />
      <TextField path={`${base}.notes`} label="Day notes" maxLength={2000} multiline />

      {exercises.fields.map((f, i) => {
        const ex = values?.exercises?.[i];
        return (
          <ExerciseCard
            key={f.id}
            base={`${base}.exercises.${i}`}
            name={ex?.exerciseName ?? f.exerciseName}
            trackingType={ex?.trackingType ?? f.trackingType}
            units={units}
            index={i}
            count={exercises.fields.length}
            onMove={(dir) => moveExercise(i, f.id, dir)}
            moveRef={(dir) => focus.buttonRef(f.id, dir)}
            onRemove={() => exercises.remove(i)}
          />
        );
      })}

      {exercisesError && <p className="text-sm text-danger">{exercisesError}</p>}
      <div>
        <ExercisePicker
          onPick={(e: ExerciseView) =>
            exercises.append({
              exerciseId: e.id,
              exerciseName: e.name,
              trackingType: e.trackingType,
              note: '',
              section: 'main',
              groupWithPrevious: false,
              block: NO_BLOCK,
              sets: [defaultSet(e.trackingType)],
            })
          }
        />
      </div>
    </div>
  );
}
