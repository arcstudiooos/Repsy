'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ExerciseView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD C2: a coach uploads their own MP4 demo for a custom exercise, or removes it. */
export function DemoUpload({ exercise }: { exercise: ExerciseView }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attach(mediaId: string | null) {
    const res = await call('PUT', `/api/v1/exercises/${exercise.id}/demo`, { mediaId });
    if (!res.ok) return res.message;
    toast.success(mediaId ? 'Demo video added' : 'Demo video removed');
    router.refresh();
    return null;
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/media?purpose=exercise_demo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as {
      data?: { id: string };
      error?: { message?: string; fieldErrors?: Record<string, string[]> };
    } | null;
    const message =
      res?.ok && json?.data
        ? await attach(json.data.id)
        : (json?.error?.fieldErrors?.file?.[0] ??
          json?.error?.message ??
          "The video couldn't be uploaded.");
    setBusy(false);
    setError(message);
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={`${id}-file`}
          className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-accent underline"
        >
          {busy
            ? 'Uploading...'
            : exercise.demoMediaId
              ? `Replace the demo video for ${exercise.name}`
              : `Upload a demo video for ${exercise.name}`}
        </label>
        <input
          id={`${id}-file`}
          type="file"
          accept="video/mp4"
          disabled={busy}
          aria-describedby={error ? `${id}-err` : undefined}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
        {exercise.demoMediaId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Remove video for ${exercise.name}`}
            onClick={() => void attach(null).then(setError)}
          >
            Remove video
          </Button>
        )}
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
