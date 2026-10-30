'use client';

import { Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import type { Units } from '@kinetic/core/units';
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
import { useMoveFocus, type MoveDirection } from './EditorFields';
import { DaySection, type Slot } from './DaySection';
import { MAX_WEEK_COUNT, type EditorDay, type EditorValues } from './editorSchema';

/** One week tab: week actions (duplicate, remove) and its training days in order. */
export function WeekSection({
  week,
  weekCount,
  units,
  onDuplicate,
  onRemove,
  onCopyToOtherWeek,
}: {
  week: number;
  weekCount: number;
  units: Units;
  /** Inserts a copy of this week right after it. */
  onDuplicate: () => void;
  onRemove: () => void;
  /** Replaces a day in another week (this week's own days are replaced here). */
  onCopyToOtherWeek: (target: Slot, day: EditorDay) => void;
}) {
  const { control, getValues } = useFormContext<EditorValues>();
  const days = useFieldArray({ control, name: `weeks.${week}.days` });
  const focus = useMoveFocus();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const n = week + 1;

  function moveDay(d: number, key: string, dir: MoveDirection) {
    focus.moved(key, dir);
    days.move(d, dir === 'up' ? d - 1 : d + 1);
  }

  function copyDay(from: number, target: Slot) {
    const copy = structuredClone(getValues(`weeks.${week}.days.${from}`));
    if (target.week === week) days.update(target.day, copy);
    else onCopyToOtherWeek(target, copy);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={`Week ${n} actions`} className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Duplicate week ${n}`}
          disabled={weekCount >= MAX_WEEK_COUNT}
          onClick={onDuplicate}
        >
          <Copy aria-hidden className="size-4" />
          Duplicate week
        </Button>
        <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Remove week ${n}`}
              disabled={weekCount <= 1}
            >
              <Trash2 aria-hidden className="size-4" />
              Remove week
            </Button>
          </DialogTrigger>
          {/* On confirm the trigger unmounts with the week; the editor then focuses the new active week's tab. */}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove week {n}?</DialogTitle>
              <DialogDescription>
                Its {days.fields.length === 1 ? 'day' : 'days'} and exercises will be removed from
                this program. Later weeks move up.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setConfirmRemove(false)}>
                Keep week
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setConfirmRemove(false);
                  onRemove();
                }}
              >
                Remove week
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {days.fields.map((f, d) => (
        <DaySection
          key={f.id}
          week={week}
          day={d}
          dayCount={days.fields.length}
          units={units}
          onMove={(dir) => moveDay(d, f.id, dir)}
          moveRef={(dir) => focus.buttonRef(f.id, dir)}
          onCopy={(target) => copyDay(d, target)}
        />
      ))}
    </div>
  );
}
