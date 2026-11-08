/** Browser-side calls to the review-flag API (same-origin, so the CSRF Origin check passes). */
import type { FlagView } from '@repsy/core';
import { call } from './checkin-api';

const enc = encodeURIComponent;

export type FlagPatch =
  | { action: 'resolve' | 'dismiss'; reason: string }
  | { action: 'snooze'; days?: number; until?: string }
  | { action: 'reopen' };

export const patchFlag = (id: string, body: FlagPatch) =>
  call<FlagView>('PATCH', `/api/v1/review-flags/${enc(id)}`, body);

export const createFollowup = (body: { clientId: string; title: string; dueLocalDate?: string }) =>
  call<FlagView>('POST', '/api/v1/review-flags', body);
