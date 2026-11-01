import type { TrackingType } from '../exercises/options';
import type { WorkoutSection } from '../programs/sections';
import type { SetTarget } from '../programs/targets';

export const SESSION_STATES = [
  'scheduled',
  'in_progress',
  'completed',
  'skipped',
  'missed',
  'incomplete',
  'cancelled',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** Not yet finished: shown as upcoming, and still loggable. */
export const OPEN_STATES = ['scheduled', 'in_progress'] as const satisfies readonly SessionState[];
/** History. `cancelled` is never listed (D-002 #7). */
export const PAST_STATES = [
  'completed',
  'skipped',
  'missed',
  'incomplete',
] as const satisfies readonly SessionState[];

/** One workout as a client performs it: an immutable WorkoutVersion with its exercises in order. */
export interface WorkoutVersionView {
  workoutVersionId: string;
  title: string;
  notes: string;
  /** True once the session has locked this version (D-002 #6); false while it resolves late (D-002 #5). */
  locked: boolean;
  exercises: {
    /** The workout_version_exercise id: set logs are keyed on it. */
    id: string;
    exerciseId: string;
    name: string;
    trackingType: TrackingType;
    instructions: string;
    /** Coaching cues from the exercise (PRD C3). */
    cues: string[];
    note: string | null;
    /** PRD C9. */
    section: WorkoutSection;
    position: number;
    sets: SetTarget[];
  }[];
}

export interface SessionSummary {
  id: string;
  clientId: string;
  /** The client's calendar date (YYYY-MM-DD), shown as-is to client and coach alike. */
  scheduledLocalDate: string;
  dueAt: string;
  state: SessionState;
  title: string;
  exerciseCount: number;
  /** D-008 #7: a coach logged (part of) this session on the client's behalf. */
  loggedByCoach: boolean;
  startedAt: string | null;
  completedAt: string | null;
  /** Still open (scheduled or in progress) after its due time. */
  overdue: boolean;
}
