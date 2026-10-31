/**
 * Body metric catalogue and unit conversion (PRD E1). Pure: no database or server imports, so browser components can
 * use it (`@kinetic/core/metric-catalog`).
 */
import { fromDisplay, toDisplay, type Units } from '../units';

const CM_PER_IN = 2.54;

export type BodyMetric =
  'weight' | 'body_fat' | 'waist' | 'hips' | 'chest' | 'arm' | 'thigh' | 'resting_hr' | 'steps';

/** How a metric is measured; decides its display unit. */
export type MetricKind = 'mass' | 'length' | 'percent' | 'bpm' | 'count';

export interface MetricDef {
  key: BodyMetric;
  label: string;
  kind: MetricKind;
  /** Accepted range in canonical units (kg, cm, %, bpm, steps), inclusive. */
  min: number;
  max: number;
}

/** The built-in metrics (PRD E1), in display order. No medical metrics (D-007). */
export const BODY_METRICS: readonly MetricDef[] = [
  { key: 'weight', label: 'Body weight', kind: 'mass', min: 20, max: 400 },
  { key: 'body_fat', label: 'Body fat', kind: 'percent', min: 2, max: 70 },
  { key: 'waist', label: 'Waist', kind: 'length', min: 30, max: 250 },
  { key: 'hips', label: 'Hips', kind: 'length', min: 30, max: 250 },
  { key: 'chest', label: 'Chest', kind: 'length', min: 30, max: 250 },
  { key: 'arm', label: 'Arm', kind: 'length', min: 10, max: 100 },
  { key: 'thigh', label: 'Thigh', kind: 'length', min: 20, max: 150 },
  { key: 'resting_hr', label: 'Resting heart rate', kind: 'bpm', min: 25, max: 220 },
  { key: 'steps', label: 'Steps', kind: 'count', min: 1, max: 150_000 },
];

const DEF = new Map(BODY_METRICS.map((d) => [d.key, d]));
export const metricDef = (key: BodyMetric): MetricDef => DEF.get(key) as MetricDef;
export const isBodyMetric = (v: unknown): v is BodyMetric =>
  typeof v === 'string' && DEF.has(v as BodyMetric);

/** The canonical (stored and exported) unit of a metric kind. */
export function canonicalUnit(kind: MetricKind): string {
  return metricUnit(kind, 'kg');
}

/** The unit a metric is shown and typed in: lb users get inches for lengths. */
export function metricUnit(kind: MetricKind, units: Units): string {
  switch (kind) {
    case 'mass':
      return units;
    case 'length':
      return units === 'lb' ? 'in' : 'cm';
    case 'percent':
      return '%';
    case 'bpm':
      return 'bpm';
    case 'count':
      return 'steps';
  }
}

/** A typed value in the user's units, converted to canonical units (three decimals for kg and cm). */
export function metricToCanonical(kind: MetricKind, value: number, units: Units): number {
  if (kind === 'mass') return fromDisplay(value, units);
  if (kind === 'length' && units === 'lb') return Math.round(value * CM_PER_IN * 1000) / 1000;
  return value;
}

/** A canonical value shown in the user's units: one decimal, whole numbers for heart rate and steps. */
export function metricFromCanonical(kind: MetricKind, value: number, units: Units): number {
  if (kind === 'mass') return toDisplay(value, units);
  if (kind === 'length') {
    const v = units === 'lb' ? value / CM_PER_IN : value;
    return Math.round(v * 10) / 10;
  }
  if (kind === 'percent') return Math.round(value * 10) / 10;
  return Math.round(value);
}
