/** Browser-side calls to the habits API (same-origin, so the CSRF Origin check passes). */
import type { HabitView } from '@repsy/core';
import { call } from './checkin-api';

const enc = encodeURIComponent;

export const createClientHabit = (clientId: string, body: Record<string, unknown>) =>
  call<HabitView>('POST', `/api/v1/clients/${enc(clientId)}/habits`, body);

export const setHabitStatusApi = (habitId: string, status: 'active' | 'archived') =>
  call<{ id: string; status: string }>('PUT', `/api/v1/habits/${enc(habitId)}/status`, { status });

export const tickHabit = (habitId: string, body: { localDate?: string; done?: boolean }) =>
  call<HabitView>('POST', `/api/v1/habits/${enc(habitId)}/log`, body);
