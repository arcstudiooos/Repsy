/** Browser-side calls for reply expectations and saved replies (same-origin, so the CSRF Origin check passes). */
import type { ReplyExpectations, SavedReplyView } from '@repsy/core';
import { call } from './checkin-api';
import type { ApiCall } from './workout-api';

export const saveExpectations = (body: { replyTargetHours: number | null; officeHours: string }) =>
  call<ReplyExpectations>('PUT', '/api/v1/org/reply-expectations', body);

export const addSavedReply = (title: string, body: string) =>
  call<SavedReplyView>('POST', '/api/v1/saved-replies', { title, body });

export async function removeSavedReply(id: string): Promise<ApiCall<null>> {
  try {
    const res = await fetch(`/api/v1/saved-replies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.status === 204) return { ok: true, data: null };
    return { ok: false, status: res.status, message: "The saved reply couldn't be deleted." };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Check your connection.' };
  }
}
