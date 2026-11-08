'use client';

import { useId, useState, type FormEvent } from 'react';
import type { SessionDetail, SwapReason, SwapView } from '@repsy/core';
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

export const SWAP_REASON_LABEL: Record<SwapReason, string> = {
  no_equipment: 'Equipment not available',
  equipment_busy: 'Equipment in use',
  preference: 'Preferred the alternative',
  other: 'Other',
};

type Alternative = NonNullable<SessionDetail['alternatives']>[string][number];

async function refreshed(sessionId: string): Promise<SessionDetail | null> {
  try {
    const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data: SessionDetail }).data;
  } catch {
    return null;
  }
}

/** "Swap exercise" (PRD D8): pick one of the coach's alternatives and a reason. */
export function SwapButton({
  sessionId,
  workoutVersionExerciseId,
  plannedName,
  alternatives,
  disabled,
  onSwapped,
}: {
  sessionId: string;
  workoutVersionExerciseId: string;
  plannedName: string;
  alternatives: Alternative[];
  disabled?: boolean;
  onSwapped: (detail: SessionDetail) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [exerciseId, setExerciseId] = useState(alternatives[0]?.exerciseId ?? '');
  const [reason, setReason] = useState<SwapReason>('equipment_busy');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await call<SwapView>(
      'POST',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/swaps`,
      {
        workoutVersionExerciseId,
        exerciseId,
        reason,
      },
    );
    if (!res.ok) {
      setBusy(false);
      toast.error(res.message);
      return;
    }
    const detail = await refreshed(sessionId);
    setBusy(false);
    setOpen(false);
    toast.success(`Swapped to ${res.data.name}.`);
    if (detail) onSwapped(detail);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-3 self-start"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Swap exercise: ${plannedName}`}
      >
        Swap exercise
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} aria-label="Swap exercise">
            <DialogHeader>
              <DialogTitle>Swap {plannedName}</DialogTitle>
              <DialogDescription>
                Your coach set these alternatives. Your coach sees the swap.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="my-4 flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Do instead</legend>
              {alternatives.map((a) => (
                <label key={a.exerciseId} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name={`${id}-ex`}
                    className="size-5"
                    value={a.exerciseId}
                    checked={exerciseId === a.exerciseId}
                    onChange={() => setExerciseId(a.exerciseId)}
                  />
                  {a.name}
                </label>
              ))}
            </fieldset>
            <div className="mb-4 flex flex-col gap-1">
              <label htmlFor={`${id}-reason`} className="text-sm font-medium">
                Reason
              </label>
              <select
                id={`${id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value as SwapReason)}
                className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
              >
                {(Object.keys(SWAP_REASON_LABEL) as SwapReason[]).map((r) => (
                  <option key={r} value={r}>
                    {SWAP_REASON_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy || !exerciseId}>
                {busy ? 'Swapping…' : 'Swap'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Instead of X" with Undo while nothing is logged for it. */
export function SwapNote({
  swap,
  sessionId,
  workoutVersionExerciseId,
  canUndo,
  onUndone,
}: {
  swap: SwapView;
  sessionId: string;
  workoutVersionExerciseId: string;
  canUndo: boolean;
  onUndone?: (detail: SessionDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-secondary">
      <span>
        Swapped from {swap.plannedName} ({SWAP_REASON_LABEL[swap.reason]})
      </span>
      {canUndo && onUndone && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch(
                `/api/v1/sessions/${encodeURIComponent(sessionId)}/swaps/${encodeURIComponent(workoutVersionExerciseId)}`,
                { method: 'DELETE', credentials: 'same-origin' },
              );
              if (!res.ok) {
                toast.error('Could not undo the swap. Try again.');
                return;
              }
              const detail = await refreshed(sessionId);
              if (detail) onUndone(detail);
            } catch {
              toast.error('Could not reach the server. Check your connection and try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo swap
        </Button>
      )}
    </p>
  );
}
