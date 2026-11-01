'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type FormEvent } from 'react';
import type { Pose, ProgressPhotoView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const POSE_LABEL: Record<Pose, string> = { front: 'Front', side: 'Side', back: 'Back' };
const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const src = (mediaId: string) => `/api/v1/media/${mediaId}`;
const select =
  'block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** Uploads the file, then records the photo. Returns an error message, or null. */
async function upload(clientId: string | null, file: File, pose: Pose, takenOn: string) {
  const qs = new URLSearchParams({ purpose: 'progress_photo', ...(clientId ? { clientId } : {}) });
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
    return (
      json?.error?.fieldErrors?.file?.[0] ??
      json?.error?.message ??
      "The photo couldn't be uploaded."
    );
  }
  const added = await call('POST', '/api/v1/progress-photos', {
    ...(clientId ? { clientId } : {}),
    mediaId: json.data.id,
    pose,
    takenOn,
  });
  return added.ok ? null : added.message;
}

/**
 * PRD E3, E4: front, side and back progress photos (private to the client and their coaches, stored without EXIF or
 * GPS), and a compare view of any two dates per pose: side by side, overlay with an opacity slider, or swipe.
 */
export function ProgressPhotos({
  clientId,
  photos,
  today,
  canUpload = true,
}: {
  /** Set on the coach side; the client side uploads for themselves. */
  clientId: string | null;
  photos: ProgressPhotoView[];
  today: string;
  canUpload?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dates = useMemo(() => [...new Set(photos.map((p) => p.takenOn))], [photos]);
  const byDate = (d: string) => photos.filter((p) => p.takenOn === d);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get('photo');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a photo.');
      return;
    }
    setBusy(true);
    setError(null);
    const message = await upload(
      clientId,
      file,
      String(data.get('pose')) as Pose,
      String(data.get('takenOn') || today),
    );
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    form.reset();
    toast.success('Photo added');
    router.refresh();
  }

  async function remove(p: ProgressPhotoView) {
    const res = await fetch(`/api/v1/progress-photos/${p.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      toast.success('Photo deleted');
      router.refresh();
    } else toast.error("Couldn't delete the photo. Try again.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Progress photos</CardTitle>
        <CardDescription>
          Only you and your coach can see these. Location and camera details are removed when a
          photo is uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {canUpload && (
          <form
            onSubmit={submit}
            noValidate
            aria-label="Add a progress photo"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-pose`} className="text-sm font-medium">
                  Pose
                </label>
                <select id={`${id}-pose`} name="pose" defaultValue="front" className={select}>
                  {(Object.keys(POSE_LABEL) as Pose[]).map((p) => (
                    <option key={p} value={p}>
                      {POSE_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-date`} className="text-sm font-medium">
                  Taken on
                </label>
                <Input
                  id={`${id}-date`}
                  name="takenOn"
                  type="date"
                  max={today}
                  defaultValue={today}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-file`} className="text-sm font-medium">
                Photo (JPEG, PNG or WebP, up to 15 MB)
              </label>
              <input
                id={`${id}-file`}
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-describedby={error ? `${id}-err` : undefined}
                className="min-h-11 text-base"
              />
            </div>
            {error && (
              <p id={`${id}-err`} role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Uploading...' : 'Add photo'}
              </Button>
            </div>
          </form>
        )}

        {dates.length === 0 ? (
          <p className="text-secondary">No photos yet.</p>
        ) : (
          <>
            {dates.length > 1 && <PhotoCompare photos={photos} dates={dates} />}
            <ol aria-label="Photos by day" className="flex flex-col gap-4">
              {dates.map((d) => (
                <li key={d}>
                  <h3 className="mb-2 font-medium">{fmt(d)}</h3>
                  <ul className="grid grid-cols-3 gap-2">
                    {byDate(d).map((p) => (
                      <li key={p.id} className="flex flex-col gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src(p.mediaId)}
                          alt={`${POSE_LABEL[p.pose]} photo, ${fmt(d)}`}
                          loading="lazy"
                          className="aspect-[3/4] w-full rounded-control bg-canvas object-cover"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${POSE_LABEL[p.pose].toLowerCase()} photo, ${fmt(d)}`}
                          onClick={() => void remove(p)}
                        >
                          Delete
                        </Button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Mode = 'side' | 'overlay' | 'swipe';

/** PRD E4: any two dates, per pose. */
function PhotoCompare({ photos, dates }: { photos: ProgressPhotoView[]; dates: string[] }) {
  const id = useId();
  const [before, setBefore] = useState(dates[dates.length - 1]!);
  const [after, setAfter] = useState(dates[0]!);
  const [pose, setPose] = useState<Pose>('front');
  const [mode, setMode] = useState<Mode>('side');
  const [amount, setAmount] = useState(50);
  const pick = (d: string) => photos.find((p) => p.takenOn === d && p.pose === pose);
  const a = pick(before);
  const b = pick(after);
  const img = (p: ProgressPhotoView | undefined, d: string, extra = '') =>
    p ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src(p.mediaId)}
        alt={`${POSE_LABEL[pose]} photo, ${fmt(d)}`}
        className={`aspect-[3/4] w-full rounded-control bg-canvas object-cover ${extra}`}
      />
    ) : (
      <p className="flex aspect-[3/4] w-full items-center justify-center rounded-control bg-canvas p-2 text-center text-sm text-secondary">
        No {POSE_LABEL[pose].toLowerCase()} photo on {fmt(d)}
      </p>
    );
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-card bg-canvas p-3">
      <h3 id={`${id}-h`} className="font-semibold">
        Compare
      </h3>
      <div className="flex flex-wrap gap-3">
        {(
          [
            ['Earlier', before, setBefore],
            ['Later', after, setAfter],
          ] as const
        ).map(([label, value, set]) => (
          <div key={label} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${label}`} className="text-sm font-medium">
              {label}
            </label>
            <select
              id={`${id}-${label}`}
              value={value}
              onChange={(e) => set(e.target.value)}
              className={select}
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {fmt(d)}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-pose`} className="text-sm font-medium">
            Pose
          </label>
          <select
            id={`${id}-pose`}
            value={pose}
            onChange={(e) => setPose(e.target.value as Pose)}
            className={select}
          >
            {(Object.keys(POSE_LABEL) as Pose[]).map((p) => (
              <option key={p} value={p}>
                {POSE_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-sm font-medium">View</legend>
        {(
          [
            ['side', 'Side by side'],
            ['overlay', 'Overlay'],
            ['swipe', 'Swipe'],
          ] as const
        ).map(([m, label]) => (
          <label key={m} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name={`${id}-mode`}
              className="size-5"
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {mode === 'side' || !a || !b ? (
        <div className="grid grid-cols-2 gap-2">
          {img(a, before)}
          {img(b, after)}
        </div>
      ) : (
        <>
          <div className="relative mx-auto w-full max-w-sm">
            {img(a, before)}
            <div
              className="absolute inset-0"
              style={
                mode === 'overlay'
                  ? { opacity: amount / 100 }
                  : { clipPath: `inset(0 ${100 - amount}% 0 0)` }
              }
            >
              {img(b, after)}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-amount`} className="text-sm font-medium">
              {mode === 'overlay' ? 'Later photo opacity' : 'Swipe between photos'}
            </label>
            <input
              id={`${id}-amount`}
              type="range"
              min={0}
              max={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-valuetext={`${amount}%`}
              className="min-h-11 accent-accent"
            />
          </div>
        </>
      )}
    </section>
  );
}
