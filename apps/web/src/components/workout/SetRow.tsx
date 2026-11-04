'use client';

import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
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

/** Column headings, short: the visible label each input's name contains ("Set 1 reps" holds "Reps"). */
const HEAD: Record<keyof SetDraft, (units: Units) => string> = {
  reps: () => 'Reps',
  weight: (u) => u,
  rpe: () => 'RPE',
  durationSeconds: () => 'Seconds',
  distanceM: () => 'Metres',
};

/** The shared grid: set number, previous, one column per field, status. */
export const setGrid = (n: number) =>
  ({
    gridTemplateColumns: `1.75rem minmax(2.5rem,4.5rem) repeat(${n}, minmax(3rem,1fr)) 1.75rem`,
  }) as const;

/** The column header for a set table. Decorative: each input names its set and field itself. */
export function SetTableHeader({
  trackingType,
  units,
}: {
  trackingType: TrackingType;
  units: Units;
}) {
  const fields = fieldsFor(trackingType);
  return (
    <div
      aria-hidden
      className="label-micro grid items-end gap-1.5 px-1 pb-1 text-secondary sm:gap-2"
      style={setGrid(fields.length)}
    >
      <span>Set</span>
      <span>Previous</span>
      {fields.map((f) => (
        <span key={f} className="text-center">
          {HEAD[f](units)}
        </span>
      ))}
      <span className="text-center">✓</span>
    </div>
  );
}

/**
 * One set as a compact table row: number, previous performance, inputs by tracking type (44px+ targets), and its
 * sync status. Saved when a field loses focus.
 */
export function SetRow({
  index,
  trackingType,
  units,
  draft,
  placeholder,
  previous,
  status,
  onChange,
  onCommit,
}: {
  index: number;
  trackingType: TrackingType;
  units: Units;
  draft: SetDraft;
  placeholder: SetDraft;
  /** Last session's matching set, e.g. "8 × 60 kg". */
  previous?: string | null;
  status: RowStatus;
  onChange(d: SetDraft): void;
  onCommit(): void;
}) {
  const id = useId();
  const fields = fieldsFor(trackingType);
  const failed = status.kind === 'error' || status.kind === 'invalid';
  const done = status.kind === 'synced' || status.kind === 'saved';
  return (
    <fieldset
      className={cn(
        'rounded-md border border-transparent px-1 py-1.5 transition-colors',
        done && 'bg-success-soft/50',
        failed && 'border-danger/40 bg-danger-soft/40',
      )}
    >
      <legend className="sr-only">Set {index + 1}</legend>
      <div className="grid items-center gap-1.5 sm:gap-2" style={setGrid(fields.length)}>
        <span
          aria-hidden
          className={cn(
            'tabular flex size-7 items-center justify-center rounded-full text-sm font-semibold',
            done ? 'bg-success text-on-accent' : 'bg-surface-2 text-secondary',
          )}
        >
          {index + 1}
        </span>
        <span className="truncate text-caption text-secondary" title={previous ?? undefined}>
          {previous ? (
            <>
              <span className="sr-only">Previous: </span>
              {previous}
            </>
          ) : (
            <span aria-hidden>–</span>
          )}
        </span>
        {fields.map((f) => (
          <Input
            key={f}
            id={`${id}-${f}`}
            aria-label={`Set ${index + 1} ${LABELS[f](units)}`}
            inputMode={f === 'reps' || f === 'durationSeconds' ? 'numeric' : 'decimal'}
            autoComplete="off"
            className="tabular min-h-12 px-1 text-center text-base font-medium sm:text-lg"
            placeholder={placeholder[f]}
            value={draft[f]}
            aria-invalid={(status.kind === 'invalid' && status.field === f) || undefined}
            aria-describedby={`${id}-status`}
            onChange={(ev) => onChange({ ...draft, [f]: ev.target.value })}
            onBlur={onCommit}
          />
        ))}
        <span className="flex justify-center">
          {done ? (
            <CheckCircle2 aria-hidden className="size-6 text-success" />
          ) : failed ? (
            <AlertCircle aria-hidden className="size-6 text-danger" />
          ) : status.kind === 'syncing' ? (
            <Loader2 aria-hidden className="size-5 animate-spin text-secondary" />
          ) : (
            <Circle aria-hidden className="size-5 text-input-border" />
          )}
        </span>
      </div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 pl-10 text-caption',
          status.kind === 'idle' && 'sr-only',
        )}
        aria-live="polite"
      >
        <span
          id={`${id}-status`}
          className={cn(
            failed ? 'text-danger' : status.kind === 'synced' ? 'text-success' : 'text-secondary',
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
