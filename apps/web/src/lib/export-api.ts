/** Browser-side calls to the export API (same-origin, so the CSRF Origin check passes). */
import type { ExportView } from '@kinetic/core';
import { call } from './checkin-api';
import type { ApiCall } from './workout-api';

export const requestExport = (scope: 'org' | 'client_self', idempotencyKey: string) =>
  call<ExportView>('POST', '/api/v1/exports', { scope, idempotencyKey });

export const exportLinks = (id: string) =>
  call<{ name: string; url: string; expiresAt: string }[]>(
    'POST',
    `/api/v1/exports/${encodeURIComponent(id)}/links`,
    {},
  );

export async function listExports(): Promise<ApiCall<ExportView[]>> {
  try {
    const res = await fetch('/api/v1/exports', { credentials: 'same-origin' });
    const json = (await res.json().catch(() => null)) as { data?: ExportView[] } | null;
    return res.ok && json?.data
      ? { ok: true, data: json.data }
      : { ok: false, status: res.status, message: "Exports couldn't be loaded." };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server.' };
  }
}
