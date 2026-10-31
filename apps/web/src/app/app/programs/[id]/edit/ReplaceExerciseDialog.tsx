'use client';

import { useState } from 'react';
import { Replace } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { PickerBody } from './ExercisePicker';
import { programExercises, replaceExerciseEverywhere, type EditorValues } from './editorSchema';

/** Replace one exercise with another in every week and day (PRD C11). The change saves like any other edit. */
export function ReplaceExerciseDialog({
  onReplace,
}: {
  onReplace: (weeks: EditorValues['weeks']) => void;
}) {
  const { getValues } = useFormContext<EditorValues>();
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState('');
  const options = open ? programExercises(getValues()) : [];
  const from = options.find((o) => o.exerciseId === fromId) ?? options[0];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFromId('');
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <Replace aria-hidden className="size-4" />
          Replace exercise
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace an exercise everywhere</DialogTitle>
          <DialogDescription>
            Swaps it in every week and day of this program. Sets and notes stay when the new
            exercise is tracked the same way.
          </DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-secondary">Add an exercise to the program first.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="replace-from" className="text-sm font-medium">
                Exercise to replace
              </label>
              <select
                id="replace-from"
                value={from?.exerciseId ?? ''}
                onChange={(e) => setFromId(e.target.value)}
                className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
              >
                {options.map((o) => (
                  <option key={o.exerciseId} value={o.exerciseId}>
                    {o.exerciseName} ({o.uses} {o.uses === 1 ? 'workout' : 'workouts'})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm font-medium">Replace with</p>
            <PickerBody
              actionLabel="Use"
              onPick={(e) => {
                if (!from) return;
                if (e.id === from.exerciseId) {
                  toast.error('Pick a different exercise.');
                  return;
                }
                const res = replaceExerciseEverywhere(getValues(), from.exerciseId, {
                  exerciseId: e.id,
                  exerciseName: e.name,
                  trackingType: e.trackingType,
                });
                onReplace(res.weeks);
                setOpen(false);
                setFromId('');
                toast.success(
                  `Replaced ${from.exerciseName} with ${e.name} in ${res.replaced} ${
                    res.replaced === 1 ? 'place' : 'places'
                  }. Save to keep it.`,
                );
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
