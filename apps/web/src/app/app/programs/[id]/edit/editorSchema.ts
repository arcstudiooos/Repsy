import { z } from 'zod';
import type { ProgramDetail, SetTarget, WeekInput } from '@kinetic/core';
import { TRACKING_TYPES, type TrackingType } from '@kinetic/core/exercise-options';
import { fromDisplay, toDisplay, type Units } from '@kinetic/core/units';

/** Mirrors the server limits in packages/core/src/programs (commit.ts, targets.ts). */
const MAX_WEEKS = 104;
export const MAX_DAYS = 7;
const MAX_EXERCISES = 30;
const MAX_SETS = 20;
const MAX_LOAD_KG = 2000;

/** The field each tracking type must have on every set. */
const REQUIRED = {
  reps_load: ['reps', 'Enter reps.'],
  duration: ['durationSec', 'Enter a duration.'],
  distance: ['distanceM', 'Enter a distance.'],
} as const satisfies Record<TrackingType, readonly [string, string]>;

/** The heaviest load the input accepts in `units`: floored, so it never converts above the server's 2000 kg. */
export const maxDisplayLoad = (units: Units): number => Math.floor(toDisplay(MAX_LOAD_KG, units));

/** Mirrors `setTargetSchema.tempo` (packages/core/src/programs/targets.ts). */
const TEMPO = /^[0-9X]{4}$/;
const TEMPO_MESSAGE = 'Use four characters, each 0-9 or X.';

const optionalNumber = (min: number, max: number) =>
  z
    .number({ error: 'Enter a number.' })
    .min(min, `Use ${min} or more.`)
    .max(max, `Use ${max} or less.`)
    .optional();

/**
 * One set as edited. `loadKg` holds the value in the coach's display units despite its name
 * (it keeps the API field name); `exactKg` remembers the stored kg value so an untouched load
 * is saved back unchanged instead of being re-rounded through the display conversion.
 */
function setSchema(units: Units) {
  return z
    .object({
      reps: optionalNumber(0, 1000).refine((v) => v === undefined || Number.isInteger(v), {
        error: 'Use a whole number.',
      }),
      loadKg: optionalNumber(0, maxDisplayLoad(units)),
      exactKg: z.number().optional(),
      rpe: optionalNumber(1, 10).refine((v) => v === undefined || Number.isInteger(v * 2), {
        error: 'Use steps of 0.5.',
      }),
      restSec: optionalNumber(0, 3600).refine((v) => v === undefined || Number.isInteger(v), {
        error: 'Use a whole number.',
      }),
      tempo: z
        .string()
        .optional()
        .refine((v) => !v || TEMPO.test(v), { error: TEMPO_MESSAGE }),
      durationSec: optionalNumber(1, 86400).refine((v) => v === undefined || Number.isInteger(v), {
        error: 'Use a whole number.',
      }),
      distanceM: optionalNumber(0, 100000),
      repsMax: optionalNumber(1, 1000).refine((v) => v === undefined || Number.isInteger(v), {
        error: 'Use a whole number.',
      }),
      rir: optionalNumber(0, 10).refine((v) => v === undefined || Number.isInteger(v), {
        error: 'Use a whole number.',
      }),
      percent1rm: optionalNumber(1, 100).refine(
        (v) => v === undefined || Number.isInteger(v * 10),
        { error: 'Use at most 1 decimal place.' },
      ),
      paceSecPerKm: optionalNumber(60, 3600).refine((v) => v === undefined || Number.isInteger(v), {
        error: 'Use a whole number.',
      }),
      hrZone: optionalNumber(1, 5).refine((v) => v === undefined || Number.isInteger(v), {
        error: 'Use a whole number.',
      }),
    })
    .refine((s) => s.repsMax === undefined || s.reps === undefined || s.repsMax >= s.reps, {
      message: 'At least the reps.',
      path: ['repsMax'],
    });
}

export function buildEditorSchema(units: Units) {
  const set = setSchema(units);
  const exercise = z
    .object({
      exerciseId: z.string(),
      exerciseName: z.string(),
      trackingType: z.enum(TRACKING_TYPES),
      note: z.string().max(500, 'Use at most 500 characters.'),
      sets: z.array(set).min(1, 'Add at least one set.').max(MAX_SETS),
    })
    .superRefine((ex, ctx) => {
      const [field, message] = REQUIRED[ex.trackingType];
      ex.sets.forEach((s, i) => {
        if (s[field] === undefined)
          ctx.addIssue({ code: 'custom', path: ['sets', i, field], message });
      });
    });
  const day = z.object({
    title: z.string().trim().min(1, 'Enter a day title.').max(120, 'Use at most 120 characters.'),
    notes: z.string().max(2000, 'Use at most 2000 characters.'),
    exercises: z
      .array(exercise)
      .min(1, 'Add at least one exercise.')
      .max(MAX_EXERCISES, `Use at most ${MAX_EXERCISES} exercises.`),
  });
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, 'Enter a program title.')
      .max(120, 'Use at most 120 characters.'),
    weeks: z
      .array(z.object({ days: z.array(day).min(1).max(MAX_DAYS) }))
      .min(1)
      .max(MAX_WEEKS),
  });
}

export type EditorValues = z.infer<ReturnType<typeof buildEditorSchema>>;
export type EditorSet =
  EditorValues['weeks'][number]['days'][number]['exercises'][number]['sets'][number];
export type EditorExercise = EditorValues['weeks'][number]['days'][number]['exercises'][number];
export type EditorDay = EditorValues['weeks'][number]['days'][number];

export const MAX_WEEK_COUNT = MAX_WEEKS;

/** A fresh set row with a sensible starting value for the tracking type. */
export function defaultSet(trackingType: TrackingType): EditorSet {
  if (trackingType === 'duration') return { durationSec: 30 };
  if (trackingType === 'distance') return { distanceM: 1000 };
  return { reps: 10 };
}

export const newDay = (n: number): EditorDay => ({ title: `Day ${n}`, notes: '', exercises: [] });

export function toEditorValues(program: ProgramDetail, units: Units): EditorValues {
  const weeks = program.weeks.length
    ? program.weeks.map((w) => ({
        days: w.days.map((d) => ({
          title: d.title,
          notes: d.notes,
          exercises: d.exercises.map((e) => ({
            exerciseId: e.exerciseId,
            exerciseName: e.exerciseName,
            trackingType: e.trackingType,
            note: e.note ?? '',
            sets: e.sets.map((s) => {
              const { loadKg, ...rest } = s;
              return loadKg === undefined
                ? rest
                : { ...rest, loadKg: toDisplay(loadKg, units), exactKg: loadKg };
            }),
          })),
        })),
      }))
    : [{ days: [newDay(1)] }];
  return { title: program.title, weeks };
}

function toSetTarget(s: EditorSet, units: Units): SetTarget {
  const out: SetTarget = {};
  if (s.reps !== undefined) out.reps = s.reps;
  if (s.loadKg !== undefined) {
    const untouched = s.exactKg !== undefined && toDisplay(s.exactKg, units) === s.loadKg;
    out.loadKg = untouched ? s.exactKg : fromDisplay(s.loadKg, units);
  }
  if (s.rpe !== undefined) out.rpe = s.rpe;
  if (s.restSec !== undefined) out.restSec = s.restSec;
  if (s.tempo) out.tempo = s.tempo;
  if (s.durationSec !== undefined) out.durationSec = s.durationSec;
  if (s.distanceM !== undefined) out.distanceM = s.distanceM;
  for (const k of EXTRA_TARGETS) if (s[k] !== undefined) out[k] = s[k];
  return out;
}

/** PRD C7 targets, copied as they are. */
const EXTRA_TARGETS = ['repsMax', 'rir', 'percent1rm', 'paceSecPerKm', 'hrZone'] as const;

/** The PATCH body's `weeks`: display units back to kg, view-only fields dropped. */
export function toWeekInputs(values: EditorValues, units: Units): WeekInput[] {
  return values.weeks.map((w) => ({
    days: w.days.map((d) => ({
      title: d.title,
      ...(d.notes ? { notes: d.notes } : {}),
      exercises: d.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        ...(e.note ? { note: e.note } : {}),
        sets: e.sets.map((s) => toSetTarget(s, units)),
      })),
    })),
  }));
}

/** A stored load in kg as typed: the exact stored kg while the display value is untouched. */
function editedKg(s: EditorSet, units: Units): number | undefined {
  if (s.loadKg === undefined || !Number.isFinite(s.loadKg)) return undefined;
  const untouched = s.exactKg !== undefined && toDisplay(s.exactKg, units) === s.loadKg;
  return untouched ? s.exactKg : fromDisplay(s.loadKg, units);
}

const finite = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : undefined);

/**
 * The autosaved draft body (S3-1): raw editor state, possibly invalid, with loads converted to kg so a draft never
 * depends on the coach's display units. Exercise names and tracking types ride along so a restored draft renders
 * without another lookup.
 */
export function toDraftPayload(
  values: EditorValues,
  units: Units,
): { title: string; weeks: unknown[] } {
  return {
    title: values.title,
    weeks: values.weeks.map((w) => ({
      days: w.days.map((d) => ({
        title: d.title,
        notes: d.notes,
        exercises: d.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          exerciseName: e.exerciseName,
          trackingType: e.trackingType,
          note: e.note,
          sets: e.sets.map((s) => {
            const out: Record<string, number | string> = {};
            for (const k of [
              'reps',
              'rpe',
              'restSec',
              'durationSec',
              'distanceM',
              'repsMax',
              'rir',
              'percent1rm',
              'paceSecPerKm',
              'hrZone',
            ] as const) {
              const v = finite(s[k]);
              if (v !== undefined) out[k] = v;
            }
            const kg = editedKg(s, units);
            if (kg !== undefined) out.loadKg = kg;
            if (s.tempo) out.tempo = s.tempo;
            return out;
          }),
        })),
      })),
    })),
  };
}

const draftNumber = z
  .number()
  .nullish()
  .transform((v) => (v === null || v === undefined || !Number.isFinite(v) ? undefined : v));

const draftShape = z.object({
  title: z.string().nullish(),
  weeks: z
    .array(
      z.object({
        days: z
          .array(
            z.object({
              title: z.string().catch(''),
              notes: z.string().catch(''),
              exercises: z.array(
                z.object({
                  exerciseId: z.string(),
                  exerciseName: z.string(),
                  trackingType: z.enum(TRACKING_TYPES),
                  note: z.string().nullish(),
                  sets: z.array(
                    z.object({
                      reps: draftNumber,
                      loadKg: draftNumber,
                      rpe: draftNumber,
                      restSec: draftNumber,
                      tempo: z.string().nullish(),
                      durationSec: draftNumber,
                      distanceM: draftNumber,
                      repsMax: draftNumber,
                      rir: draftNumber,
                      percent1rm: draftNumber,
                      paceSecPerKm: draftNumber,
                      hrZone: draftNumber,
                    }),
                  ),
                }),
              ),
            }),
          )
          .min(1)
          .max(MAX_DAYS),
      }),
    )
    .min(1)
    .max(MAX_WEEKS),
});

/** Editor values from a stored draft (server or device copy), or null when its shape is unusable. */
export function fromDraftPayload(
  draft: { title?: string | null; weeks: unknown[] },
  fallbackTitle: string,
  units: Units,
): EditorValues | null {
  const parsed = draftShape.safeParse(draft);
  if (!parsed.success) return null;
  return {
    title: parsed.data.title ?? fallbackTitle,
    weeks: parsed.data.weeks.map((w) => ({
      days: w.days.map((d) => ({
        title: d.title,
        notes: d.notes,
        exercises: d.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          exerciseName: e.exerciseName,
          trackingType: e.trackingType,
          note: e.note ?? '',
          sets: e.sets.map((s) => {
            const out: EditorSet = {};
            for (const k of [
              'reps',
              'rpe',
              'restSec',
              'durationSec',
              'distanceM',
              'repsMax',
              'rir',
              'percent1rm',
              'paceSecPerKm',
              'hrZone',
            ] as const) {
              if (s[k] !== undefined) out[k] = s[k];
            }
            if (s.tempo) out.tempo = s.tempo;
            if (s.loadKg !== undefined) {
              out.loadKg = toDisplay(s.loadKg, units);
              out.exactKg = s.loadKg;
            }
            return out;
          }),
        })),
      })),
    })),
  };
}

/** Editor fields a server path can name, below `weeks.{w}.days.{d}`. */
const FIELD_PATH =
  /^\d+\.days\.\d+\.(?:title|notes|exercises|exercises\.\d+\.(?:note|sets|sets\.\d+\.(?:reps|loadKg|rpe|restSec|tempo|durationSec|distanceM|repsMax|rir|percent1rm|paceSecPerKm|hrZone)))$/;
/** The editor's own message for a missing tracked field, by field name. */
const REQUIRED_MESSAGE = new Map<string, string>(Object.values(REQUIRED));
/** commit.ts reports a missing tracked field on the set: `{path}.sets.{s}: {field} is required.` */
const REQUIRED_ON_SET = /^(\d+\.days\.\d+\.exercises\.\d+\.sets\.\d+): (\w+) is required\.$/;

/**
 * Splits a 422's `fieldErrors.weeks` (`"{w}.days.{d}.exercises.{e}.sets.{s}: …"`) into messages for the editor field
 * each path names and the rest (no path, or a path the editor has no field for), shown above the form.
 */
export function mapServerWeekErrors(messages: string[]): {
  fields: { path: string; message: string }[];
  other: string[];
} {
  const fields: { path: string; message: string }[] = [];
  const other: string[] = [];
  for (const m of messages) {
    const required = REQUIRED_ON_SET.exec(m);
    const requiredMessage = required ? REQUIRED_MESSAGE.get(required[2]!) : undefined;
    if (required && requiredMessage) {
      fields.push({ path: `weeks.${required[1]}.${required[2]}`, message: requiredMessage });
      continue;
    }
    const at = m.indexOf(': ');
    const path = at > 0 ? m.slice(0, at) : '';
    if (FIELD_PATH.test(path)) {
      fields.push({ path: `weeks.${path}`, message: m.slice(at + 2) });
    } else {
      other.push(m);
    }
  }
  return { fields, other };
}

/** Each distinct exercise in the program with how many workouts use it, in first-seen order (PRD C11). */
export function programExercises(
  values: EditorValues,
): { exerciseId: string; exerciseName: string; trackingType: TrackingType; uses: number }[] {
  const seen = new Map<
    string,
    { exerciseId: string; exerciseName: string; trackingType: TrackingType; uses: number }
  >();
  for (const w of values.weeks)
    for (const d of w.days)
      for (const e of d.exercises) {
        const hit = seen.get(e.exerciseId);
        if (hit) hit.uses += 1;
        else seen.set(e.exerciseId, { ...e, uses: 1 });
      }
  return [...seen.values()].map(({ exerciseId, exerciseName, trackingType, uses }) => ({
    exerciseId,
    exerciseName,
    trackingType,
    uses,
  }));
}

/**
 * Replaces one exercise with another in every week and day (PRD C11). Sets, notes and order are kept when the
 * tracking type matches; otherwise each set restarts from the new type's default.
 */
export function replaceExerciseEverywhere(
  values: EditorValues,
  fromId: string,
  to: { exerciseId: string; exerciseName: string; trackingType: TrackingType },
): { weeks: EditorValues['weeks']; replaced: number } {
  let replaced = 0;
  const weeks = values.weeks.map((w) => ({
    days: w.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => {
        if (e.exerciseId !== fromId) return e;
        replaced += 1;
        return {
          ...e,
          exerciseId: to.exerciseId,
          exerciseName: to.exerciseName,
          trackingType: to.trackingType,
          sets:
            e.trackingType === to.trackingType
              ? e.sets
              : e.sets.map(() => defaultSet(to.trackingType)),
        };
      }),
    })),
  }));
  return { weeks, replaced };
}

/** Load steps the adjusted values round to, in display units. */
const LOAD_STEP: Record<Units, number> = { kg: 0.5, lb: 1 };

/**
 * Scales every set load in one week by `percent` (PRD C11), rounded to 0.5 kg or 1 lb and kept within 0 and the
 * input's maximum. Sets without a load are untouched. A changed load drops its exact stored kg value.
 */
export function scaleWeekLoads(
  days: EditorDay[],
  percent: number,
  units: Units,
): { days: EditorDay[]; changed: number } {
  const step = LOAD_STEP[units];
  const max = maxDisplayLoad(units);
  let changed = 0;
  const next = days.map((d) => ({
    ...d,
    exercises: d.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => {
        if (s.loadKg === undefined) return s;
        const scaled = Math.round((s.loadKg * (1 + percent / 100)) / step) * step;
        const loadKg = Math.min(max, Math.max(0, Math.round(scaled * 10) / 10));
        if (loadKg === s.loadKg) return s;
        changed += 1;
        const next: EditorSet = { ...s, loadKg };
        delete next.exactKg;
        return next;
      }),
    })),
  }));
  return { days: next, changed };
}
