/** Browser-side calls to the notes API (same-origin, so the CSRF Origin check passes). */
import type { ClientContext, NoteView } from '@kinetic/core';
import { call } from './checkin-api';
import type { ApiCall } from './workout-api';

const enc = encodeURIComponent;

export const addNote = (clientId: string, body: string) =>
  call<NoteView>('POST', `/api/v1/clients/${enc(clientId)}/notes`, { body });

export const editNote = (noteId: string, body: string) =>
  call<NoteView>('PATCH', `/api/v1/notes/${enc(noteId)}`, { body });

export async function removeNote(noteId: string): Promise<ApiCall<null>> {
  try {
    const res = await fetch(`/api/v1/notes/${enc(noteId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.status === 204) return { ok: true, data: null };
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return {
      ok: false,
      status: res.status,
      message: json?.error?.message ?? "The note couldn't be deleted.",
    };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Check your connection.' };
  }
}

/** Pins a note to the client context card, or unpins it (PRD B7). */
export const pinNote = (noteId: string, pinned: boolean) =>
  call<ClientContext>('PUT', `/api/v1/notes/${enc(noteId)}/pin`, { pinned });

/** Updates the client context card fields given (PRD B7). */
export const updateContext = (clientId: string, body: Record<string, string>) =>
  call<ClientContext>('PATCH', `/api/v1/clients/${enc(clientId)}/context`, body);
