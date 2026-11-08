/** Browser-side calls to the locations (PRD A15) and group classes (PRD K12) API. */
import type { RosterEntry } from '@repsy/core';
import { call } from './checkin-api';
import type { ApiCall } from './workout-api';

export const createLocation = (body: { name: string; address?: string | null }) =>
  call<{ id: string }>('POST', '/api/v1/locations', body);

export const updateLocation = (
  id: string,
  body: { name?: string; address?: string | null; archived?: boolean },
) => call<{ id: string }>('PATCH', `/api/v1/locations/${encodeURIComponent(id)}`, body);

export const setStaffLocation = (userId: string, locationId: string | null) =>
  call<{ locationId: string | null }>('PUT', '/api/v1/locations/staff', { userId, locationId });

export const setClientLocation = (clientId: string, locationId: string | null) =>
  call<{ locationId: string | null }>(
    'PUT',
    `/api/v1/clients/${encodeURIComponent(clientId)}/location`,
    { locationId },
  );

export const createClass = (body: {
  title: string;
  description?: string | null;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  repeatWeeks?: number;
  locationId?: string | null;
  coachUserId?: string | null;
}) => call<{ seriesId: string; created: number }>('POST', '/api/v1/classes', body);

const classPath = (id: string, rest = '') => `/api/v1/classes/${encodeURIComponent(id)}${rest}`;

export const enrollInClass = (id: string, clientId?: string) =>
  call<{ status: 'booked' | 'waitlisted' }>('POST', classPath(id, '/enroll'), { clientId });

export const leaveClass = (id: string, clientId?: string) =>
  call<{ promotedClientIds: string[] }>('POST', classPath(id, '/leave'), { clientId });

export const setClassCapacity = (id: string, capacity: number) =>
  call<{ promotedClientIds: string[] }>('PATCH', classPath(id), { capacity });

export const cancelClass = (id: string, wholeSeries: boolean) =>
  call<{ cancelled: number }>('POST', classPath(id, '/cancel'), { wholeSeries });

export const markAttendance = (id: string, marks: { clientId: string; attended: boolean }[]) =>
  call<{ marked: number }>('PUT', classPath(id, '/attendance'), { marks });

export async function loadRoster(id: string): Promise<ApiCall<RosterEntry[]>> {
  try {
    const res = await fetch(classPath(id, '/roster'), { credentials: 'same-origin' });
    const json = (await res.json().catch(() => null)) as {
      data?: RosterEntry[];
      error?: { message?: string };
    } | null;
    if (res.ok && json?.data) return { ok: true, data: json.data };
    return {
      ok: false,
      status: res.status,
      message: json?.error?.message ?? 'Could not load the roster. Try again.',
    };
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }
}
