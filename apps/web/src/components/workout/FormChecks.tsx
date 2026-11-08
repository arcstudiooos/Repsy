'use client';

import { useId, useState } from 'react';
import type { FormCheckView } from '@repsy/core';
import { call } from '@/lib/checkin-api';

/**
 * PRD D10: form-check videos on one exercise of a session. Anyone who can log the session can add one (an MP4 up to
 * 50 MB, about a minute); the coach sees them on the session and in review.
 */
export function FormChecks({
  sessionId,
  workoutVersionExerciseId,
  name,
  videos,
  clientId,
  canAdd,
  onAdded,
}: {
  sessionId: string;
  workoutVersionExerciseId: string;
  name: string;
  videos: FormCheckView[];
  /** Set when a coach adds one for the client. */
  clientId: string | null;
  canAdd: boolean;
  onAdded(v: FormCheckView): void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const qs = new URLSearchParams({ purpose: 'form_check', ...(clientId ? { clientId } : {}) });
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
    if (!res?.ok || !json?.data) {
      setBusy(false);
      setError(
        json?.error?.fieldErrors?.file?.[0] ??
          json?.error?.message ??
          "The video couldn't be uploaded.",
      );
      return;
    }
    const added = await call<FormCheckView>('POST', `/api/v1/sessions/${sessionId}/form-checks`, {
      mediaId: json.data.id,
      workoutVersionExerciseId,
    });
    setBusy(false);
    if (added.ok) onAdded(added.data);
    else setError(added.fieldErrors?.file?.[0] ?? added.message);
  }
  if (videos.length === 0 && !canAdd) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {videos.map((v, i) => (
        <video
          key={v.id}
          src={`/api/v1/media/${v.mediaId}`}
          controls
          playsInline
          preload="metadata"
          aria-label={`Form check ${i + 1} for ${name}`}
          className="w-full max-w-sm rounded-control bg-canvas"
        >
          <track kind="captions" />
        </video>
      ))}
      {canAdd && (
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start text-accent underline has-focus-visible:outline-2 has-focus-visible:outline-accent">
          <input
            type="file"
            accept="video/mp4"
            className="sr-only"
            disabled={busy}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
          {busy ? 'Uploading video…' : `Add a form-check video for ${name}`}
        </label>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
