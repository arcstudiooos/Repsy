'use client';

import type { SsoSettingView } from '@repsy/core';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const selectClass =
  'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** PRD A16: single sign-on with Google Workspace or Microsoft Entra ID for the workspace's team. */
export function SsoSection({
  initial,
  canEdit,
  googleAvailable,
  microsoftAvailable,
}: {
  initial: SsoSettingView | null;
  canEdit: boolean;
  googleAvailable: boolean;
  microsoftAvailable: boolean;
}) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [provider, setProvider] = useState<'google' | 'microsoft'>(
    initial?.provider ?? (googleAvailable || !microsoftAvailable ? 'google' : 'microsoft'),
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setErrors({});
    setBusy(true);
    const res = await call<SsoSettingView>('PUT', '/api/v1/org/sso', {
      provider,
      domain: String(data.get('domain') ?? ''),
      microsoftTenantId: provider === 'microsoft' ? String(data.get('tenant') ?? '') : null,
      enforced: data.get('enforced') === 'on',
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast.error(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      return;
    }
    setSaved(res.data);
    toast.success('Single sign-on saved');
  }

  async function remove() {
    if (!window.confirm('Turn off single sign-on? Your team signs in with passwords again.'))
      return;
    setBusy(true);
    const res = await fetch('/api/v1/org/sso', { method: 'DELETE', credentials: 'same-origin' });
    setBusy(false);
    if (!res.ok) return toast.error('Could not turn it off. Try again.');
    setSaved(null);
    toast.success('Single sign-on turned off');
  }

  const err = (k: string) => errors[k]?.[0];
  const unavailable = !googleAvailable && !microsoftAvailable;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Single sign-on</CardTitle>
        <CardDescription>
          Let your team sign in with Google Workspace or Microsoft. Invite each person first; single
          sign-on signs them into their Repsy account. Clients are not affected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <p className="text-sm text-secondary">
            Single sign-on is not set up on this server yet. It needs Google or Microsoft sign-in
            keys.
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <fieldset disabled={!canEdit || busy} className="flex flex-col gap-3">
              <label htmlFor={`${id}-provider`} className="text-sm font-medium">
                Provider
              </label>
              <select
                id={`${id}-provider`}
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'google' | 'microsoft')}
                className={selectClass}
              >
                {googleAvailable && <option value="google">Google Workspace</option>}
                {microsoftAvailable && <option value="microsoft">Microsoft Entra ID</option>}
              </select>

              <label htmlFor={`${id}-domain`} className="text-sm font-medium">
                Team email domain
              </label>
              <Input
                id={`${id}-domain`}
                name="domain"
                placeholder="studio.com"
                defaultValue={saved?.domain ?? ''}
                aria-invalid={!!err('domain')}
                aria-describedby={`${id}-domain-hint`}
              />
              <p id={`${id}-domain-hint`} className="text-sm text-secondary">
                {err('domain') ?? 'Must match your own email address.'}
              </p>

              {provider === 'microsoft' && (
                <>
                  <label htmlFor={`${id}-tenant`} className="text-sm font-medium">
                    Directory (tenant) ID
                  </label>
                  <Input
                    id={`${id}-tenant`}
                    name="tenant"
                    defaultValue={saved?.microsoftTenantId ?? ''}
                    aria-invalid={!!err('microsoftTenantId')}
                    aria-describedby={`${id}-tenant-hint`}
                  />
                  <p id={`${id}-tenant-hint`} className="text-sm text-secondary">
                    {err('microsoftTenantId') ??
                      'In Microsoft Entra admin centre, under Overview. Only accounts from this directory can sign in.'}
                  </p>
                </>
              )}

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="enforced"
                  defaultChecked={saved?.enforced ?? false}
                  className="mt-1 size-4"
                />
                <span>
                  Require it: team members on this domain cannot sign in with a password.
                  {err('enforced') && <span className="block text-danger">{err('enforced')}</span>}
                </span>
              </label>
            </fieldset>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
                {saved && (
                  <Button type="button" variant="ghost" disabled={busy} onClick={remove}>
                    Turn off
                  </Button>
                )}
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
