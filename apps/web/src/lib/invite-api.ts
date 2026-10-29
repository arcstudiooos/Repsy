/** Browser-side calls to the invite API (same-origin, so the CSRF Origin check passes). */
export type InviteCall = { ok: true } | { ok: false; message: string };

async function call(clientId: string, method: 'POST' | 'DELETE', fallback: string) {
  try {
    const res = await fetch(`/api/v1/clients/${encodeURIComponent(clientId)}/invite`, {
      method,
      credentials: 'same-origin',
    });
    if (res.ok) return { ok: true } as const;
    if (res.status === 429) {
      return { ok: false, message: 'Too many invites sent. Try again later.' } as const;
    }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (res.status === 409 && body?.error?.message) {
      return { ok: false, message: body.error.message } as const;
    }
    return { ok: false, message: fallback } as const;
  } catch {
    return {
      ok: false,
      message: 'Could not reach the server. Check your connection and try again.',
    } as const;
  }
}

export const sendInvite = (clientId: string): Promise<InviteCall> =>
  call(clientId, 'POST', "The invite couldn't be sent. Try again.");

export const revokeInvite = (clientId: string): Promise<InviteCall> =>
  call(clientId, 'DELETE', "The invite couldn't be revoked. Try again.");
