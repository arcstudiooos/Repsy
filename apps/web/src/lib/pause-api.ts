/** Browser-side calls to the client pause API (same-origin, so the CSRF Origin check passes). */
import type { ClientView } from '@kinetic/core';
import type { ApiCall } from './workout-api';

const OFFLINE = 'Could not reach the server. Check your connection and try again.';

async function send(
  method: 'POST' | 'PATCH',
  clientId: string,
  path: string,
  body: unknown,
): Promise<ApiCall<ClientView>> {
  try {
    const res = await fetch(`/api/v1/clients/${encodeURIComponent(clientId)}${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: ClientView;
      error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
    } | null;
    if (res.ok && json?.data) return { ok: true, data: json.data };
    return {
      ok: false,
      status: res.status,
      code: json?.error?.code,
      fieldErrors: json?.error?.fieldErrors,
      message: json?.error?.message ?? 'Something went wrong. Try again.',
    };
  } catch {
    return { ok: false, status: 0, message: OFFLINE };
  }
}

export const pauseClient = (
  clientId: string,
  body: { startLocalDate: string; resumeLocalDate: string },
) => send('POST', clientId, '/pause', body);

export const changeResumeDate = (clientId: string, resumeLocalDate: string) =>
  send('PATCH', clientId, '/pause', { resumeLocalDate });

export const resumeClient = (clientId: string) => send('POST', clientId, '/pause/resume', {});
