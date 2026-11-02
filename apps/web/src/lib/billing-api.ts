/** Browser-side calls to the billing API (same-origin, so the CSRF Origin check passes). 204 counts as success. */
export type Sent<T> =
  | { ok: true; data: T | null }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string[]> };

export async function send<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Sent<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 204) return { ok: true, data: null };
    const json = (await res.json().catch(() => null)) as {
      data?: T;
      error?: { message?: string; fieldErrors?: Record<string, string[]> };
    } | null;
    if (res.ok) return { ok: true, data: (json?.data ?? null) as T | null };
    return {
      ok: false,
      status: res.status,
      message:
        res.status === 429
          ? 'Too many tries. Wait a moment and retry.'
          : (json?.error?.message ?? 'Something went wrong. Try again.'),
      fieldErrors: json?.error?.fieldErrors,
    };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Check your connection.' };
  }
}

/** The first field error, else the message. */
export const firstError = (r: Extract<Sent<unknown>, { ok: false }>): string =>
  Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.message;
