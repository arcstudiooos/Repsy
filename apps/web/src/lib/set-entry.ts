// Client code: value imports only from core's dependency-free subpaths (the barrel pulls in the database layer).
import type { SetTarget } from '@repsy/core';
import type { TrackingType } from '@repsy/core/exercise-options';
import { fromDisplay, toDisplay, type Units } from '@repsy/core/units';

/** One set row as typed: strings, so a half-typed "6." or an empty box round-trips untouched. */
export interface SetDraft {
  reps: string;
  weight: string;
  rpe: string;
  durationSeconds: string;
  distanceM: string;
}

export const EMPTY_DRAFT: SetDraft = {
  reps: '',
  weight: '',
  rpe: '',
  durationSeconds: '',
  distanceM: '',
};

/** The stored fields a set log carries (kg for weight). */
export interface SetValues {
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
}

/** Which inputs a tracking type shows (D-008 #8). */
export function fieldsFor(trackingType: TrackingType): (keyof SetDraft)[] {
  if (trackingType === 'duration') return ['durationSeconds'];
  if (trackingType === 'distance') return ['distanceM'];
  return ['reps', 'weight', 'rpe'];
}

const show = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** A stored set (kg) as inputs in the viewer's units. */
export function draftFromValues(v: Partial<SetValues>, units: Units): SetDraft {
  return {
    reps: show(v.reps),
    weight:
      v.weightKg === null || v.weightKg === undefined ? '' : String(toDisplay(v.weightKg, units)),
    rpe: show(v.rpe),
    durationSeconds: show(v.durationSeconds),
    distanceM: show(v.distanceM),
  };
}

/** Placeholder hints from the prescription, in the viewer's units. */
export function draftFromTarget(t: SetTarget | undefined, units: Units): SetDraft {
  if (!t) return EMPTY_DRAFT;
  return draftFromValues(
    {
      reps: t.reps ?? null,
      weightKg: t.loadKg ?? null,
      rpe: t.rpe ?? null,
      durationSeconds: t.durationSec ?? null,
      distanceM: t.distanceM ?? null,
    },
    units,
  );
}

const parse = (s: string): number | null | 'invalid' => {
  const raw = s.trim();
  // A comma is a decimal comma ("62,5"), never a thousands separator: "1,500" is refused rather than read as 1.5.
  if (/,\d{3}/.test(raw) || (raw.match(/,/g)?.length ?? 0) > 1) return 'invalid';
  const t = raw.replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
};

export type DraftResult =
  { ok: true; values: SetValues } | { ok: false; field: keyof SetDraft; message: string };

/**
 * Typed inputs → stored values (weight converted to kg via `fromDisplay`, Review Focus #5). Only the fields the
 * tracking type shows are sent; the others are null. Bounds match the API (0–1000 reps, 0–2000 kg, RPE 1–10).
 */
export function valuesFromDraft(
  d: SetDraft,
  trackingType: TrackingType,
  units: Units,
): DraftResult {
  const shown = new Set(fieldsFor(trackingType));
  const out: SetValues = {
    reps: null,
    weightKg: null,
    rpe: null,
    durationSeconds: null,
    distanceM: null,
  };
  const fail = (field: keyof SetDraft, message: string): DraftResult => ({
    ok: false,
    field,
    message,
  });

  if (shown.has('reps')) {
    const v = parse(d.reps);
    if (v === 'invalid' || (v !== null && (!Number.isInteger(v) || v < 0 || v > 1000))) {
      return fail('reps', 'Enter whole reps from 0 to 1000.');
    }
    out.reps = v;
  }
  if (shown.has('weight')) {
    const v = parse(d.weight);
    const kg = v === null || v === 'invalid' ? v : fromDisplay(v, units);
    if (kg === 'invalid' || (kg !== null && (kg < 0 || kg > 2000))) {
      return fail('weight', units === 'lb' ? 'Enter 0 to 4409 lb.' : 'Enter 0 to 2000 kg.');
    }
    out.weightKg = kg;
  }
  if (shown.has('rpe')) {
    const v = parse(d.rpe);
    if (v === 'invalid' || (v !== null && (v < 1 || v > 10 || !Number.isInteger(v * 2)))) {
      return fail('rpe', 'Enter RPE 1 to 10 in steps of 0.5.');
    }
    out.rpe = v;
  }
  if (shown.has('durationSeconds')) {
    const v = parse(d.durationSeconds);
    if (v === 'invalid' || (v !== null && (!Number.isInteger(v) || v < 0 || v > 86400))) {
      return fail('durationSeconds', 'Enter whole seconds up to 86400.');
    }
    out.durationSeconds = v;
  }
  if (shown.has('distanceM')) {
    const v = parse(d.distanceM);
    if (v === 'invalid' || (v !== null && (v < 0 || v > 100000))) {
      return fail('distanceM', 'Enter 0 to 100000 metres.');
    }
    out.distanceM = v === null ? null : Math.round(v * 1000) / 1000;
  }
  return { ok: true, values: out };
}

/** True when the row holds nothing worth saving. */
export const isBlank = (v: SetValues): boolean =>
  v.reps === null &&
  v.weightKg === null &&
  v.rpe === null &&
  v.durationSeconds === null &&
  v.distanceM === null;
