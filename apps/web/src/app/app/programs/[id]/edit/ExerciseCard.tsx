'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import type { TrackingType } from '@kinetic/core/exercise-options';
import type { Units } from '@kinetic/core/units';
import { SECTION_LABEL, WORKOUT_SECTIONS } from '@kinetic/core/workout-sections';
import { BLOCK_FORMATS, BLOCK_FORMAT_LABEL, type BlockFormat } from '@kinetic/core/workout-blocks';
import { Button } from '@/components/ui/button';
import { MoveButtons, NumberField, TextField, useError, type MoveDirection } from './EditorFields';
import { defaultSet, type EditorValues } from './editorSchema';
import { KitWarning } from './EquipmentGuide';

/** Tempo is typed as four characters; stored upper-case so "31x1" matches the server pattern. */
const tempoValue = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

/** PRD C9: where the exercise sits in the workout. */
function SectionField({ base }: { base: string }) {
  const { register } = useFormContext<EditorValues>();
  const id = useId();
  return (
    <div className="flex flex-col gap-1 sm:max-w-xs">
      <label htmlFor={id} className="text-sm font-medium">
        Section
      </label>
      <select
        id={id}
        {...register(`${base}.section` as never)}
        className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
      >
        {WORKOUT_SECTIONS.map((s) => (
          <option key={s} value={s}>
            {SECTION_LABEL[s]}
          </option>
        ))}
      </select>
    </div>
  );
}

const BLOCK_HINT: Record<BlockFormat, string> = {
  superset: 'Do the exercises in this block back to back, then rest.',
  circuit: 'Go round every exercise in the block for the rounds.',
  interval: 'Work and rest on a timer for the rounds.',
  amrap: 'As many rounds as possible in the time.',
  emom: 'Start a round every minute on the minute.',
  for_time: 'Finish the rounds as fast as possible.',
};

/** PRD C8: join the block above, or start a block with a format and its settings. */
function BlockFields({ base, index }: { base: string; index: number }) {
  const { control, register } = useFormContext<EditorValues>();
  const id = useId();
  const joined = useWatch({ control, name: `${base}.groupWithPrevious` as never }) as unknown as
    boolean | undefined;
  const format = useWatch({ control, name: `${base}.block.format` as never }) as unknown as
    BlockFormat | '' | undefined;
  const isJoined = index > 0 && joined === true;
  return (
    <div className="flex flex-col gap-3">
      {index > 0 && (
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input
            type="checkbox"
            className="size-5 accent-accent"
            {...register(`${base}.groupWithPrevious` as never)}
          />
          Group with the exercise above (superset or circuit)
        </label>
      )}
      {!isJoined && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 sm:max-w-xs">
            <label htmlFor={id} className="text-sm font-medium">
              Block
            </label>
            <select
              id={id}
              aria-describedby={format ? `${id}-hint` : undefined}
              {...register(`${base}.block.format` as never)}
              className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
            >
              <option value="">No block</option>
              {BLOCK_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {BLOCK_FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
            {format && (
              <p id={`${id}-hint`} className="text-sm text-secondary">
                {BLOCK_HINT[format]}
              </p>
            )}
          </div>
          {format && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {format !== 'amrap' && format !== 'emom' && (
                <NumberField path={`${base}.block.rounds`} label="Rounds" step="1" />
              )}
              {format === 'interval' && (
                <>
                  <NumberField path={`${base}.block.workSec`} label="Work (s)" step="1" />
                  <NumberField path={`${base}.block.restSec`} label="Rest (s)" step="1" />
                </>
              )}
              {(format === 'amrap' || format === 'emom' || format === 'for_time') && (
                <NumberField
                  path={`${base}.block.minutes`}
                  label={format === 'for_time' ? 'Time cap (min)' : 'Minutes'}
                  step="1"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      <SectionField base={base} />
      <BlockFields base={base} index={index} />
      <TextField path={`${base}.note`} label="Exercise note" maxLength={500} multiline />
      <SetRows base={base} trackingType={trackingType} units={units} />
    </div>
  );
}
