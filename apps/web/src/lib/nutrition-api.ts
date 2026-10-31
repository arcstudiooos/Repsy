/** Browser-side calls to the nutrition API (same-origin, so the CSRF Origin check passes). */
import type { NutritionView } from '@kinetic/core';
import { call } from './checkin-api';

const base = (clientId: string) => `/api/v1/clients/${encodeURIComponent(clientId)}/nutrition`;

export const setTargetApi = (clientId: string, body: Record<string, number | string | null>) =>
  call<NutritionView>('PUT', `${base(clientId)}/target`, body);

export const logDayApi = (clientId: string, body: Record<string, number | string | null>) =>
  call<NutritionView>('PUT', `${base(clientId)}/log`, body);
