/** Browser-side calls to the session API (same-origin, so the CSRF Origin check passes). */
import type { SessionDetail, SetLogAck } from '@kinetic/core';

export type ApiCall<T> =
  { ok: true; data: T } | { ok: false; status: number; code?: string; message: string };

const OFFLINE = 'Could not reach the server. Check your connection and try again.';

async function post<T>(sessionId: string, action: string, body: unknown): Promise<ApiCall<T>> {
  try {
    const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: T;
      error?: { code?: string; message?: string };
    } | null;
    if (res.ok && json && 'data' in json) return { ok: true, data: json.data as T };
    return {
      ok: false,
      status: res.status,
      code: json?.error?.code,
      message:
        res.status === 429
          ? 'Too many saves at once. Wait a moment and retry.'
          : (json?.error?.message ?? 'Something went wrong. Try again.'),
    };
  } catch {
    return { ok: false, status: 0, message: OFFLINE };
  }
}

export const startWorkout = (sessionId: string) => post<SessionDetail>(sessionId, 'start', {});

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
