'use client';

import { useId, useState, type FormEvent } from 'react';
import type { PublicPageSettings } from '@kinetic/core';
import { useHydrated } from '@/components/time/LocalTime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const AREA = 'min-h-24 rounded-control border border-input-border bg-surface px-3 py-2 text-base';

/** PRD B15: the workspace's public page with an application form. */
export function PublicPageSection({
  initial,
  canEdit,
}: {
  initial: PublicPageSettings;
  canEdit: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(initial);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError(null);
    const res = await call<PublicPageSettings>('PUT', '/api/v1/org/public-page', {
      slug: String(data.get('slug') ?? ''),
      bio: String(data.get('bio') ?? ''),
      offers: String(data.get('offers') ?? ''),
      enabled: data.get('enabled') === 'on',
    });
    if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
    setSaved(res.data);
    toast.success('Public page saved');
  }
  // The origin is only known in the browser: render the link after hydration so server and client markup match.
  const hydrated = useHydrated();
  const url = saved.slug && hydrated ? `${window.location.origin}/join/${saved.slug}` : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Public page</CardTitle>
        <CardDescription>
          A page with your bio, what you offer and an application form. Applications appear under
          Leads.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset disabled={!canEdit} className="flex flex-col gap-3">
            <label htmlFor={`${id}-slug`} className="text-sm font-medium">
              Address (repsy…/join/your-name)
            </label>
            <Input id={`${id}-slug`} name="slug" defaultValue={initial.slug ?? ''} maxLength={40} />
            <label htmlFor={`${id}-bio`} className="text-sm font-medium">
              About you
            </label>
            <textarea
              id={`${id}-bio`}
              name="bio"
              defaultValue={initial.bio ?? ''}
              maxLength={4000}
              className={AREA}
            />
            <label htmlFor={`${id}-offers`} className="text-sm font-medium">
              What you offer
            </label>
            <textarea
              id={`${id}-offers`}
              name="offers"
              defaultValue={initial.offers ?? ''}
              maxLength={4000}
              className={AREA}
            />
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={initial.enabled}
                className="size-5 accent-accent"
              />
              Page is live
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {saved.enabled && url && (
            <p className="text-sm break-all text-secondary">
              Live at{' '}
              <a href={url} className="text-accent underline">
                {url}
              </a>
            </p>
          )}
          {canEdit && (
            <div>
              <Button type="submit">Save public page</Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
