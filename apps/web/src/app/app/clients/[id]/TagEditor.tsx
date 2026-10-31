'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { TagColor, TagView } from '@kinetic/core';
import { TAG_DOT } from '@/components/tags/TagBadge';

const TAG_COLORS = Object.keys(TAG_DOT) as TagColor[];
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { createTagApi, setClientTagsApi } from '@/lib/tag-api';

/** Pick a client's tags from the workspace's, or create a new one (PRD B4). */
export function TagEditor({
  clientId,
  all,
  selected,
}: {
  clientId: string;
  all: TagView[];
  selected: string[];
}) {
  const router = useRouter();
  const id = useId();
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected));
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('teal');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: Set<string>) {
    setBusy(true);
    const res = await setClientTagsApi(clientId, [...next]);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.fieldErrors?.tagIds?.[0] ?? res.message);
      return false;
    }
    setChosen(next);
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      {all.length === 0 ? (
        <p className="text-secondary">No tags yet. Create the first one below.</p>
      ) : (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">Tags</legend>
          {all.map((t) => (
            <label key={t.id} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={chosen.has(t.id)}
                disabled={busy}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(t.id);
                  else next.delete(t.id);
                  void save(next);
                }}
              />
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: TAG_DOT[t.color] }}
              />
              {t.name}
            </label>
          ))}
        </fieldset>
      )}
      <form
        noValidate
        aria-label="New tag"
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await createTagApi(name, color);
          setBusy(false);
          if (!res.ok) {
            setError(res.fieldErrors?.name?.[0] ?? res.message);
            return;
          }
          setError(null);
          setName('');
          const next = new Set(chosen).add(res.data.id);
          if (await save(next)) toast.success(`Tagged "${res.data.name}".`);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            New tag
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-color`} className="text-sm font-medium">
            Colour
          </label>
          <select
            id={`${id}-color`}
            value={color}
            onChange={(e) => setColor(e.target.value as TagColor)}
            className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
          >
            {TAG_COLORS.map((c) => (
              <option key={c} value={c}>
                {c[0]!.toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
          Add tag
        </Button>
        {error && (
          <p id={`${id}-error`} role="alert" className="w-full text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
