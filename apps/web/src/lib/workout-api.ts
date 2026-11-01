/** Browser-side calls to the session API (same-origin, so the CSRF Origin check passes). */
import type { SessionDetail, SetLogAck } from '@kinetic/core';

export type ApiCall<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code?: string;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

const OFFLINE = 'Could not reach the server. Check your connection and try again.';

async function send<T>(
  method: 'POST' | 'PATCH',
  sessionId: string,
  action: string,
  body: unknown,
): Promise<ApiCall<T>> {
  try {
    const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/${action}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: T;
      error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
    } | null;
    if (res.ok && json && 'data' in json) return { ok: true, data: json.data as T };
    return {
      ok: false,
      status: res.status,
      code: json?.error?.code,
      fieldErrors: json?.error?.fieldErrors,
      message:
        res.status === 429
          ? 'Too many saves at once. Wait a moment and retry.'
          : (json?.error?.message ?? 'Something went wrong. Try again.'),
    };
  } catch {
    return { ok: false, status: 0, message: OFFLINE };
  }
}

const post = <T>(sessionId: string, action: string, body: unknown) =>
  send<T>('POST', sessionId, action, body);

export const startWorkout = (sessionId: string) => post<SessionDetail>(sessionId, 'start', {});

/** PRD D17: the optional readiness answers, sent just before Start. */
export const saveReadiness = (sessionId: string, answers: Record<string, number>) =>
  post<{ score: number }>(sessionId, 'readiness', answers);

export interface SetLogPayload {
  workoutVersionExerciseId: string;
  setIndex: number;
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  clientUpdatedAt: string;
  clientMutationId: string;
}

export const saveSets = (sessionId: string, items: SetLogPayload[]) =>
  post<SetLogAck[]>(sessionId, 'logs', { items });

export const finishWorkout = (
  sessionId: string,
  kind: 'complete' | 'skip',
  body: { idempotencyKey: string; comment?: string },
) => post<SessionDetail>(sessionId, kind, body);

/**
 * Edits a finished workout's sets (S3-4): the client within 24 hours, a coach with a reason. Online only: it calls
 * the API directly and never goes through the offline outbox.
 */
export type RevisionPayload = Pick<
  SetLogPayload,
  'workoutVersionExerciseId' | 'setIndex' | 'clientUpdatedAt' | 'clientMutationId'
> &
  Partial<Pick<SetLogPayload, 'reps' | 'weightKg' | 'rpe' | 'durationSeconds' | 'distanceM'>>;

export const reviseSets = (sessionId: string, items: RevisionPayload[], reason?: string) =>
  send<SetLogAck[]>('PATCH', sessionId, 'logs', {
    items,
    ...(reason !== undefined ? { reason } : {}),
  });
