/** Browser-side calls to the check-in API (same-origin, so the CSRF Origin check passes). */
import type {
  CheckinAnswers,
  CheckinQuestion,
  CheckinTemplateView,
  CheckinView,
} from '@kinetic/core';
import type { ApiCall } from './workout-api';

const OFFLINE = 'Could not reach the server. Check your connection and try again.';

export async function call<T>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
): Promise<ApiCall<T>> {
  try {
    const res = await fetch(path, {
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

const enc = encodeURIComponent;

export const saveCheckinDraft = (id: string, answers: CheckinAnswers) =>
  call<{ savedAt: string }>('PUT', `/api/v1/checkins/${enc(id)}/draft`, { answers });

export const submitCheckin = (id: string, answers: CheckinAnswers, idempotencyKey: string) =>
  call<CheckinView>('POST', `/api/v1/checkins/${enc(id)}/submit`, { answers, idempotencyKey });

export const setCheckinWeekday = (
  clientId: string,
  checkinWeekday: number | null,
  checkinEveryWeeks?: number,
) =>
  call<{ checkinWeekday: number | null; checkinEveryWeeks: number }>(
    'PUT',
    `/api/v1/clients/${enc(clientId)}/checkin-schedule`,
    {
      checkinWeekday,
      ...(checkinEveryWeeks !== undefined ? { checkinEveryWeeks } : {}),
    },
  );

export const updateCheckinTemplate = (body: { title?: string; questions?: CheckinQuestion[] }) =>
  call<CheckinTemplateView>('PATCH', '/api/v1/checkin-template', body);

/** A coach marks a sent check-in reviewed (PRD F14). */
export const markReviewed = (id: string) =>
  call<CheckinView>('POST', `/api/v1/checkins/${enc(id)}/review`, {});
