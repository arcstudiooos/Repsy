import type { TrackingType } from '@kinetic/core/exercise-options';

export const TRACKING_LABEL: Record<TrackingType, string> = {
  reps_load: 'Reps and load',
  duration: 'Duration',
  distance: 'Distance',
};

/** Shared by the filter bar and the add dialog so selects look the same. */
export const SELECT_CLASS =
  'min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink aria-invalid:border-danger sm:w-auto';
