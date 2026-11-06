/** Browser-side calls to the AI assistant API (PRD I15). Same-origin, so the CSRF Origin check passes. */
import type { AiConversationView, AiMessageView } from '@kinetic/core';
import { call } from './checkin-api';
import type { ApiCall } from './workout-api';

export const askAssistant = (body: { conversationId?: string; question: string }) =>
  call<{ conversationId: string; messages: AiMessageView[] }>(
    'POST',
    '/api/v1/assistant/messages',
    body,
  );

export const setAssistantEnabled = (aiEnabled: boolean) =>
  call<{ aiEnabled: boolean }>('PUT', '/api/v1/assistant/settings', { aiEnabled });

async function send<T>(method: 'GET' | 'DELETE', path: string): Promise<ApiCall<T>> {
  try {
    const res = await fetch(path, { method, credentials: 'same-origin' });
    const json = (await res.json().catch(() => null)) as {
      data?: T;
      error?: { code?: string; message?: string };
    } | null;
    if (res.ok && json && 'data' in json) return { ok: true, data: json.data as T };
    return {
      ok: false,
      status: res.status,
      code: json?.error?.code,
      message: json?.error?.message ?? 'Something went wrong. Try again.',
    };
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }
}

export const loadConversation = (id: string) =>
  send<AiConversationView>('GET', `/api/v1/assistant/conversations/${encodeURIComponent(id)}`);

export const removeConversation = (id: string) =>
  send<{ deleted: true }>('DELETE', `/api/v1/assistant/conversations/${encodeURIComponent(id)}`);
