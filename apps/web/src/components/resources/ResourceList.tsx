'use client';

import { useRouter } from 'next/navigation';
import type { ResourceView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

/** Resources as cards: a link opens in a new tab; text shows in full (PRD G5). */
export function ResourceList({ items, canRemove }: { items: ResourceView[]; canRemove: boolean }) {
  const router = useRouter();
  async function remove(r: ResourceView) {
    try {
      const res = await fetch(`/api/v1/resources/${encodeURIComponent(r.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('remove');
      toast.success(`Removed ${r.title}.`);
      router.refresh();
    } catch {
      toast.error('Could not remove it. Try again.');
    }
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Resources">
      {items.map((r) => (
        <li key={r.id} className="rounded-card bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-base font-semibold break-words">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-accent underline underline-offset-4"
                >
                  {r.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                r.title
              )}
            </h2>
            {r.sharedWith && (
              <span className="rounded-control bg-canvas px-2 py-1 text-sm text-secondary">
                {r.sharedWith}
              </span>
            )}
          </div>
          {r.body && <p className="mt-2 break-words whitespace-pre-line">{r.body}</p>}
          {canRemove && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 -ml-3"
              onClick={() => void remove(r)}
              aria-label={`Remove ${r.title}`}
            >
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
