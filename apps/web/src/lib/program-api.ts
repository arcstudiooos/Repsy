/** Browser-side calls to the program builder API (same-origin, so the CSRF Origin check passes). */
import type { PreviousPerformance, ProgramDetail, WeekInput } from '@kinetic/core';

export interface ProgramApiError {
  ok: false;
  /** 0 when the server could not be reached. */
  status: number;
  code?: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, string | number | boolean | null>;
}

export type ProgramApiCall<T> = { ok: true; data: T } | ProgramApiError;

const OFFLINE = 'Could not reach the server. Check your connection and try again.';

async function call<T>(
  url: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<ProgramApiCall<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      credentials: 'same-origin',
      ...(init.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, status: 0, message: OFFLINE };
  }
  if (res.status === 204) return { ok: true, data: null as T };
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    error?: Omit<ProgramApiError, 'ok' | 'status'>;
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
    fieldErrors: json?.error?.fieldErrors,
    details: json?.error?.details,
  };
}

const programUrl = (id: string) => `/api/v1/programs/${encodeURIComponent(id)}`;

/** "Save changes": commits a new version when `expectedVersion` is still the current one (else 409). */
export const commitProgram = (
  id: string,
  body: { expectedVersion: number | null; title?: string; weeks: WeekInput[] },
) => call<ProgramDetail>(programUrl(id), { method: 'PATCH', body });

/** Discards the program's draft (idempotent). */
export const discardProgramDraft = (id: string) =>
  call<null>(`${programUrl(id)}/draft`, { method: 'DELETE' });

/** Per exercise id, the client's most recent completed performance (at most 30 ids per call). */
export const fetchClientHistory = (clientId: string, exerciseIds: string[]) =>
  call<Record<string, PreviousPerformance>>(
    `/api/v1/clients/${encodeURIComponent(clientId)}/history?exerciseIds=${exerciseIds
      .map(encodeURIComponent)
      .join(',')}`,
  );
