'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { Branding } from '@kinetic/core';
import { accentProblem, contrastRatio, HEX } from '@kinetic/core/brand-color';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** Workspace branding clients see in their portal (PRD A6): accent colour and logo. Owner only. */
export function BrandingSection({ branding, canEdit }: { branding: Branding; canEdit: boolean }) {
  const router = useRouter();
  const id = useId();
  const [accent, setAccent] = useState(branding.accent ?? '');
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const value = accent.trim().toLowerCase();
  const valid = HEX.test(value);
  const problem = value && valid ? accentProblem(value) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const res = await call('PUT', '/api/v1/org/branding', {
      accent: value || null,
      logoUrl: logoUrl.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
      if (Object.keys(fe).length === 0) toast.error(res.message);
      return;
    }
    toast.success('Branding saved.');
    router.refresh();
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${id}-${k}-err`} className="text-sm text-danger">
        {errors[k]}
      </p>
    ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Branding</CardTitle>
        <CardDescription>
          Clients see your workspace name, logo and accent colour in their portal. Leave a field
          empty to use Repsy&apos;s.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Branding" className="flex flex-col gap-4">
          <fieldset disabled={!canEdit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 sm:max-w-xs">
              <label htmlFor={`${id}-accent`} className="text-sm font-medium">
                Accent colour (hex)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-accent`}
                  value={accent}
                  placeholder="#4f46e5"
                  maxLength={7}
                  onChange={(e) => setAccent(e.target.value)}
                  aria-invalid={errors.accent || problem ? true : undefined}
                  aria-describedby={`${id}-accent-help`}
                />
                <span
                  aria-hidden
                  className="size-11 shrink-0 rounded-control border border-input-border"
                  style={{ background: valid ? value : 'transparent' }}
                />
              </div>
              <p id={`${id}-accent-help`} className="text-sm text-secondary">
                {valid && !problem
                  ? `White text contrast ${contrastRatio(value, '#ffffff').toFixed(1)}:1 (AA needs 4.5:1).`
                  : (problem ??
                    'Buttons use this colour with white text, so it must be dark enough.')}
              </p>
              {err('accent')}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-logo`} className="text-sm font-medium">
                Logo link (https image, optional)
              </label>
              <Input
                id={`${id}-logo`}
                type="url"
                value={logoUrl}
                placeholder="https://"
                onChange={(e) => setLogoUrl(e.target.value)}
                aria-invalid={errors.logoUrl ? true : undefined}
                aria-describedby={errors.logoUrl ? `${id}-logoUrl-err` : undefined}
              />
              {err('logoUrl')}
            </div>
          </fieldset>
          {canEdit ? (
            <div>
              <Button type="submit" disabled={busy || Boolean(problem)}>
                {busy ? 'Saving…' : 'Save branding'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-secondary">Only the workspace owner can change branding.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
