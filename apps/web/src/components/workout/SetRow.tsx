'use client';

import { useId } from 'react';
import type { TrackingType, Units } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldsFor, type SetDraft } from '@/lib/set-entry';
import { cn } from '@/lib/utils';

export type RowStatus =
  | { kind: 'idle' }
  /** Edited since its last sync and not sent yet. */
  | { kind: 'unsaved' }
  /** Stored on this device, waiting for the server (S3-3). */
  | { kind: 'saved' }
  | { kind: 'syncing' }
  | { kind: 'synced' }
  | { kind: 'error'; message: string }
  | { kind: 'invalid'; field: keyof SetDraft; message: string };

const LABELS: Record<keyof SetDraft, (units: Units) => string> = {
  reps: () => 'reps',
  weight: (u) => `weight (${u})`,
  rpe: () => 'RPE',
  durationSeconds: () => 'seconds',
  distanceM: () => 'metres',
};

/** One set: inputs by tracking type (44px+ targets), saved when a field loses focus, with its sync status. */
export function SetRow({
  index,
  trackingType,
  units,
  draft,
  placeholder,
  status,
  onChange,
  onCommit,
}: {
  index: number;
  trackingType: TrackingType;
  units: Units;
  draft: SetDraft;
  placeholder: SetDraft;
  status: RowStatus;
  onChange(d: SetDraft): void;
  onCommit(): void;
}) {
  const id = useId();
  const fields = fieldsFor(trackingType);
  const failed = status.kind === 'error' || status.kind === 'invalid';
  return (
    <fieldset className="flex flex-col gap-2 rounded-control border border-divider p-3">
      <legend className="px-1 text-sm font-semibold">Set {index + 1}</legend>
      <div className="grid grid-cols-3 gap-2">
        {fields.map((f) => {
          const label = `Set ${index + 1} ${LABELS[f](units)}`;
          return (
            <div key={f} className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-${f}`} className="text-sm text-secondary">
                {LABELS[f](units)}
              </label>
              <Input
                id={`${id}-${f}`}
                aria-label={label}
                inputMode={f === 'reps' || f === 'durationSeconds' ? 'numeric' : 'decimal'}
                autoComplete="off"
                className="min-h-12"
                placeholder={placeholder[f]}
                value={draft[f]}
                aria-invalid={(status.kind === 'invalid' && status.field === f) || undefined}
                aria-describedby={`${id}-status`}
                onChange={(ev) => onChange({ ...draft, [f]: ev.target.value })}
                onBlur={onCommit}
              />
            </div>
          );
        })}
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <span
          id={`${id}-status`}
          className={cn(
            failed ? 'text-danger' : status.kind === 'synced' ? 'text-accent' : 'text-secondary',
          )}
        >
          {status.kind === 'saved' && 'Saved on device'}
          {status.kind === 'syncing' && 'Syncing'}
          {status.kind === 'synced' && 'Synced'}
          {status.kind === 'unsaved' && 'Not synced yet'}
          {status.kind === 'error' && `Not synced. ${status.message}`}
          {status.kind === 'invalid' && status.message}
        </span>
        {status.kind === 'error' && (
          <Button size="sm" variant="secondary" className="md:min-h-11" onClick={onCommit}>
            Retry
          </Button>
        )}
      </div>
    </fieldset>
  );
}
