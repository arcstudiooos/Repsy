/** Uploads a file to private storage (`POST /api/v1/media`) and returns its id, or a message to show. */
export async function uploadMedia(
  purpose: 'nutrition' | 'progress_photo' | 'message' | 'form_check' | 'exercise_demo',
  file: File,
  clientId?: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const qs = new URLSearchParams({ purpose, ...(clientId ? { clientId } : {}) });
  const res = await fetch(`/api/v1/media?${qs}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  }).catch(() => null);
  const json = (await res?.json().catch(() => null)) as {
    data?: { id: string };
    error?: { message?: string; fieldErrors?: Record<string, string[]> };
  } | null;
  if (res?.ok && json?.data) return { ok: true, id: json.data.id };
  return {
    ok: false,
    message:
      json?.error?.fieldErrors?.file?.[0] ??
      json?.error?.message ??
      "The file couldn't be uploaded.",
  };
}
