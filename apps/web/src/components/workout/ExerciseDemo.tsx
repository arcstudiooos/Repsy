'use client';

import { useState, useSyncExternalStore } from 'react';
import { parseExerciseMedia } from '@kinetic/core/exercise-media';
import { Button } from '@/components/ui/button';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/**
 * PRD C2, D7: the exercise's demo video, opened with one tap (nothing loads before that). Offline, the cues stay
 * readable and this says the video needs a connection.
 */
export function ExerciseDemo({ url, name }: { url: string | null | undefined; name: string }) {
  const media = parseExerciseMedia(url);
  const [open, setOpen] = useState(false);
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (!media) return null;
  if (!online) return <p className="mt-2 text-secondary">Video needs a connection.</p>;
  if (media.kind === 'link') {
    return (
      <a
        href={media.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-11 items-center text-accent underline"
      >
        Open the demo for {name}
      </a>
    );
  }
  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        aria-label={`Watch demo: ${name}`}
        onClick={() => setOpen(true)}
      >
        Watch demo
      </Button>
    );
  }
  return (
    <div className="mt-2 aspect-video w-full overflow-hidden rounded-control bg-canvas">
      {media.kind === 'video' ? (
        <video src={media.src} controls playsInline className="h-full w-full">
          <track kind="captions" />
        </video>
      ) : (
        <iframe
          src={media.embedUrl}
          title={`Demo: ${name}`}
          className="h-full w-full"
          allow="encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </div>
  );
}

/** A small thumbnail for lists (YouTube has one; others show a play mark). Decorative: the name is beside it. */
export function MediaThumb({ url }: { url: string | null | undefined }) {
  const media = parseExerciseMedia(url);
  if (!media || media.kind === 'link') return null;
  if (media.kind === 'youtube') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={media.thumbnailUrl}
        alt=""
        width={64}
        height={36}
        loading="lazy"
        className="h-9 w-16 shrink-0 rounded-control object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-9 w-16 shrink-0 items-center justify-center rounded-control bg-canvas text-secondary"
    >
      ▶
    </span>
  );
}
