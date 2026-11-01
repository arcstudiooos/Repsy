/** Browser-side calls to the messages API (same-origin, so the CSRF Origin check passes). */
import type { MessageView } from '@kinetic/core';
import { call } from './checkin-api';
import type { ApiCall } from './workout-api';

const enc = encodeURIComponent;

export async function fetchMessages(
  threadId: string,
  cursor?: string,
): Promise<ApiCall<{ items: MessageView[]; nextCursor: string | null }>> {
  try {
    const qs = cursor ? `?cursor=${enc(cursor)}` : '';
    const res = await fetch(`/api/v1/threads/${enc(threadId)}/messages${qs}`, {
      credentials: 'same-origin',
    });
    const json = (await res.json().catch(() => null)) as {
      data?: MessageView[];
      meta?: { nextCursor: string | null };
      error?: { message?: string };
    } | null;
    if (res.ok && json?.data) {
      return { ok: true, data: { items: json.data, nextCursor: json.meta?.nextCursor ?? null } };
    }
    return {
      ok: false,
      status: res.status,
      message: json?.error?.message ?? "Messages couldn't be loaded. Try again.",
    };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Check your connection.' };
  }
}

export const postMessage = (
  threadId: string,
  body: string,
  clientMessageId: string,
  anchor?: { type: string; id: string },
  attachmentMediaId?: string,
) =>
  call<MessageView>('POST', `/api/v1/threads/${enc(threadId)}/messages`, {
    body,
    clientMessageId,
    ...(anchor ? { anchor } : {}),
    ...(attachmentMediaId ? { attachmentMediaId } : {}),
  });
