'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import type { TrackingType } from '@kinetic/core/exercise-options';
import type { Units } from '@kinetic/core/units';
import { Button } from '@/components/ui/button';
import { MoveButtons, NumberField, TextField, useError, type MoveDirection } from './EditorFields';
import { defaultSet, type EditorValues } from './editorSchema';
import { KitWarning } from './EquipmentGuide';

/** Tempo is typed as four characters; stored upper-case so "31x1" matches the server pattern. */
const tempoValue = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

function SetRows({
  base,
  trackingType,
  units,
}: {
  base: string;
  trackingType: TrackingType;
  units: Units;
}) {
  const { control, getValues } = useFormContext<EditorValues>();
  const { fields, append, remove } = useFieldArray({ control, name: `${base}.sets` as never });
  const setsError = useError(`${base}.sets`);
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f, i) => (
        <div
          key={f.id}
          role="group"
          aria-label={`Set ${i + 1}`}
          className="flex items-end gap-2 rounded-control bg-canvas p-3"
        >
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {trackingType === 'reps_load' && (
              <>
                <NumberField path={`${base}.sets.${i}.reps`} label="Reps" step="1" />
                <NumberField path={`${base}.sets.${i}.repsMax`} label="Top of range" step="1" />
                <NumberField path={`${base}.sets.${i}.loadKg`} label={`Load (${units})`} />
                <NumberField path={`${base}.sets.${i}.percent1rm`} label="% of 1RM" step="0.5" />
                <NumberField path={`${base}.sets.${i}.rir`} label="RIR" step="1" />
                <NumberField path={`${base}.sets.${i}.rpe`} label="RPE" step="0.5" />
                <TextField
                  path={`${base}.sets.${i}.tempo`}
                  label="Tempo"
                  maxLength={4}
                  inputProps={{
                    autoCapitalize: 'characters',
                    autoComplete: 'off',
                    spellCheck: false,
                  }}
                  options={{ setValueAs: tempoValue }}
                />
              </>
            )}
            {trackingType === 'duration' && (
              <NumberField path={`${base}.sets.${i}.durationSec`} label="Duration (s)" step="1" />
            )}
            {trackingType === 'distance' && (
              <NumberField path={`${base}.sets.${i}.distanceM`} label="Distance (m)" />
            )}
            {trackingType !== 'reps_load' && (
              <>
                <NumberField
                  path={`${base}.sets.${i}.paceSecPerKm`}
                  label="Pace (s per km)"
                  step="1"
                />
                <NumberField path={`${base}.sets.${i}.hrZone`} label="Heart-rate zone" step="1" />
              </>
            )}
            <NumberField path={`${base}.sets.${i}.restSec`} label="Rest (s)" step="1" />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove set ${i + 1}`}
            disabled={fields.length <= 1}
            onClick={() => remove(i)}
          >
            <Trash2 aria-hidden className="size-5" />
          </Button>
        </div>
      ))}
      {setsError && <p className="text-sm text-danger">{setsError}</p>}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={fields.length >= 20}
          onClick={() => {
            const sets = getValues(`${base}.sets` as never) as unknown as unknown[];
            const last = sets[sets.length - 1];
            append((last ? structuredClone(last) : defaultSet(trackingType)) as never);
          }}
        >
          <Plus aria-hidden className="size-4" />
          Add set
        </Button>
      </div>
    </div>
  );
}

/** One exercise of a day: its note, its sets, and move/remove controls. */
export function ExerciseCard({
  base,
  name,
  trackingType,
  units,
  index,
  count,
  onMove,
  moveRef,
  onRemove,
}: {
  /** `weeks.{w}.days.{d}.exercises.{e}` */
  base: string;
  name: string;
  trackingType: TrackingType;
  units: Units;
  index: number;
  count: number;
  onMove: (dir: MoveDirection) => void;
  moveRef: (dir: MoveDirection) => (el: HTMLButtonElement | null) => void;
  onRemove: () => void;
}) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-divider p-3"
    >
      <div className="flex flex-wrap items-center gap-1">
        <h4 id={headingId} className="min-w-0 flex-1 text-base font-semibold break-words">
          {name}
        </h4>
        <MoveButtons name={name} index={index} count={count} onMove={onMove} buttonRef={moveRef} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      <KitWarning base={base} name={name} />
      <TextField path={`${base}.note`} label="Exercise note" maxLength={500} multiline />
      <SetRows base={base} trackingType={trackingType} units={units} />
    </div>
  );
}
