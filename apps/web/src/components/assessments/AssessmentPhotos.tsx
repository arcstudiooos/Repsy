'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { ClientAssessmentView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { GuideOverlay } from './GuideOverlay';

const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const src = (mediaId: string) => `/api/v1/media/${mediaId}`;

async function upload(
  clientId: string | null,
  item: ClientAssessmentView,
  file: File,
  takenOn: string,
) {
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
  const added = await call('POST', `/api/v1/client-assessments/${item.id}/photos`, {
    mediaId: json.data.id,
    takenOn,
  });
  return added.ok ? null : added.message;
}

function Photo({
  mediaId,
  alt,
  item,
  guides,
}: {
  mediaId: string;
  alt: string;
  item: ClientAssessmentView;
  guides: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-control bg-canvas">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src(mediaId)} alt={alt} className="block h-auto w-full" />
      {guides && <GuideOverlay guide={item.guide} />}
    </div>
  );
}

function Item({
  clientId,
  item,
  today,
  canEnd,
}: {
  clientId: string | null;
  item: ClientAssessmentView;
  today: string;
  canEnd: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guides, setGuides] = useState(item.guide !== 'none');
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const latest = item.photos[0];
  const first = item.photos.length > 1 ? item.photos[item.photos.length - 1] : undefined;

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
    const message = await upload(clientId, item, file, String(data.get('takenOn') || today));
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    form.reset();
    setPreview(null);
    toast.success('Assessment photo added');
    router.refresh();
  }

  async function del(path: string, done: string) {
    const res = await fetch(path, { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      toast.success(done);
      router.refresh();
    } else toast.error("That didn't work. Try again.");
  }

  return (
    <section
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-3 rounded-control border border-divider p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`${id}-h`} className="font-semibold break-words">
            {item.title}
          </h3>
          <p className="text-sm text-secondary">
            {item.due ? 'Due now' : item.dueOn ? `Next photo ${fmt(item.dueOn)}` : 'Done'}
            {item.everyWeeks > 0 &&
              ` · retest every ${item.everyWeeks} ${item.everyWeeks === 1 ? 'week' : 'weeks'}`}
          </p>
        </div>
        {canEnd && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Stop asking: ${item.title}`}
            onClick={() => void del(`/api/v1/client-assessments/${item.id}`, 'Assessment stopped')}
          >
            Stop asking
          </Button>
        )}
      </div>
      {item.instructions && <p className="break-words whitespace-pre-line">{item.instructions}</p>}
      {item.guide !== 'none' && item.photos.length > 0 && (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-accent"
            checked={guides}
            onChange={(e) => setGuides(e.target.checked)}
          />
          Show guide lines on {item.title}
        </label>
      )}
      {latest && (
        <div className={first ? 'grid grid-cols-2 gap-3' : 'max-w-xs'}>
          {first && (
            <figure className="flex flex-col gap-1">
              <Photo
                mediaId={first.mediaId}
                alt={`${item.title}, first photo, ${fmt(first.takenOn)}`}
                item={item}
                guides={guides}
              />
              <figcaption className="text-sm text-secondary">
                First · {fmt(first.takenOn)}
              </figcaption>
            </figure>
          )}
          <figure className="flex flex-col gap-1">
            <Photo
              mediaId={latest.mediaId}
              alt={`${item.title}, ${first ? 'latest' : ''} photo, ${fmt(latest.takenOn)}`}
              item={item}
              guides={guides}
            />
            <figcaption className="text-sm text-secondary">
              {first ? 'Latest' : 'Photo'} · {fmt(latest.takenOn)}
            </figcaption>
          </figure>
        </div>
      )}
      {item.photos.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-accent">
            All {item.photos.length} {item.photos.length === 1 ? 'photo' : 'photos'}
          </summary>
          <ul className="flex flex-col gap-1">
            {item.photos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <a href={src(p.mediaId)} className="underline underline-offset-4">
                  {fmt(p.takenOn)}
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete photo from ${fmt(p.takenOn)}`}
                  onClick={() => void del(`/api/v1/assessment-photos/${p.id}`, 'Photo deleted')}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-file`} className="text-sm font-medium">
              Photo for {item.title}
            </label>
            <input
              id={`${id}-file`}
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="max-w-full text-base"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-date`} className="text-sm font-medium">
              Taken on
            </label>
            <Input id={`${id}-date`} name="takenOn" type="date" max={today} defaultValue={today} />
          </div>
          <Button type="submit" disabled={busy}>
            Add photo
          </Button>
        </div>
        {preview && (
          <div className="max-w-xs">
            <p className="mb-1 text-sm text-secondary">
              Check you are lined up{item.guide !== 'none' && ' with the guide lines'} before adding
              it.
            </p>
            <div className="relative overflow-hidden rounded-control">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Preview of the chosen photo"
                className="block h-auto w-full"
              />
              <GuideOverlay guide={item.guide} />
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

/** PRD E5: assessments asked of the client, with the first and latest photo side by side under guide lines. */
export function AssessmentPhotos({
  clientId,
  items,
  today,
  canEnd = false,
  assign,
}: {
  clientId: string | null;
  items: ClientAssessmentView[];
  today: string;
  canEnd?: boolean;
  assign?: React.ReactNode;
}) {
  if (items.length === 0 && !assign) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Assessments</CardTitle>
        <CardDescription>
          Photos taken the same way each time, so posture and mobility changes are easy to see. Only
          you and your coach can see them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {assign}
        {items.map((item) => (
          <Item key={item.id} clientId={clientId} item={item} today={today} canEnd={canEnd} />
        ))}
      </CardContent>
    </Card>
  );
}
