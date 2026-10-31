'use client';

import { useState } from 'react';
import type { AlternativeView, ExerciseView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { PickerBody } from '../programs/[id]/edit/ExercisePicker';

const MAX = 5;

/** The coach's alternatives for one exercise (PRD C4): clients can swap to these while logging (D8). */
export function AlternativesEditor({ exercise }: { exercise: ExerciseView }) {
  const [list, setList] = useState<AlternativeView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/exercises/${encodeURIComponent(exercise.id)}/alternatives`;

  async function load() {
    if (list || loading) return;
    setLoading(true);
    try {
      const res = await fetch(base, { credentials: 'same-origin' });
      const json = (await res.json()) as { data?: AlternativeView[] };
      setList(json.data ?? []);
    } catch {
      toast.error('Could not load alternatives. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function save(next: AlternativeView[]) {
    setBusy(true);
    const res = await call<AlternativeView[]>('PUT', base, {
      alternativeIds: next.map((a) => a.exerciseId),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.fieldErrors?.alternativeIds?.[0] ?? res.message);
      return false;
    }
    setList(res.data);
    return true;
  }

  return (
    <details
      className="mt-2"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium">
        Alternatives{list ? ` (${list.length})` : ''}
      </summary>
      {loading && <p className="text-sm text-secondary">Loading…</p>}
      {list && (
        <div className="flex flex-col gap-2">
          {list.length === 0 ? (
            <p className="text-sm text-secondary">
              None yet. Clients can swap to an alternative while logging.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {list.map((a) => (
                <li key={a.exerciseId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{a.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${a.name} as an alternative to ${exercise.name}`}
                    onClick={() => void save(list.filter((x) => x.exerciseId !== a.exerciseId))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {list.length < MAX && (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={busy}
              onClick={() => setPicking(true)}
              aria-label={`Add alternative to ${exercise.name}`}
            >
              Add alternative
            </Button>
          )}
        </div>
      )}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alternative to {exercise.name}</DialogTitle>
            <DialogDescription>
              Pick an exercise tracked the same way, so the planned sets still fit.
            </DialogDescription>
          </DialogHeader>
          <PickerBody
            actionLabel="Use"
            onPick={async (picked) => {
              if (!list) return;
              if (picked.id === exercise.id) {
                toast.error('An exercise cannot be its own alternative.');
                return;
              }
              if (picked.trackingType !== exercise.trackingType) {
                toast.error('Pick an exercise tracked the same way (reps, time or distance).');
                return;
              }
              if (list.some((a) => a.exerciseId === picked.id)) {
                setPicking(false);
                return;
              }
              const ok = await save([
                ...list,
                { exerciseId: picked.id, name: picked.name, trackingType: picked.trackingType },
              ]);
              if (ok) setPicking(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </details>
  );
}
