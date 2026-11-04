'use client';

import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { buttonClass, Field, FormMessage, inputClass } from '@/components/auth-ui';
import { acceptWithSignupAction, type AcceptState } from './actions';

export interface AcceptFormProps {
  token: string;
  orgName: string;
  /** Invite email, shown locked (signed-out only). */
  email: string;
  /** Signed in as the invitee: no password, posts to the API route. */
  signedIn: boolean;
  privacyText: string;
  timezones: string[];
}

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {children}
    </label>
  );
}

export function AcceptForm(props: AcceptFormProps) {
  const { token, orgName, email, signedIn, privacyText, timezones } = props;
  const [state, action, pending] = useActionState<AcceptState, FormData>(
    acceptWithSignupAction,
    {},
  );
  const [zone, setZone] = useState('UTC');
  const [zones, setZones] = useState(timezones);
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const errors = signedIn ? apiErrors : (state.fieldErrors ?? {});
  const busy = signedIn ? submitting : pending;

  useEffect(() => {
    // Browser default zone, added to the list if the server's list lacks it.
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browser) return;
    // Intentional post-hydration sync: the browser zone is unknown during SSR.
    /* eslint-disable react-hooks/set-state-in-effect */
    setZones((z) => (z.includes(browser) ? z : [browser, ...z]));
    setZone(browser);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function submitSignedIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setApiErrors({});
    try {
      const res = await fetch('/api/v1/auth/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          consent: form.get('consent') === 'on',
          timezone: String(form.get('timezone') ?? ''),
          preferredUnits: String(form.get('preferredUnits') ?? 'kg'),
          goals: String(form.get('goals') ?? '').trim() || undefined,
        }),
      });
      if (res.ok) {
        window.location.assign('/portal');
        return;
      }
      const body = (await res.json()) as {
        error?: { message?: string; fieldErrors?: Record<string, string[]> };
      };
      const fields = Object.fromEntries(
        Object.entries(body.error?.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? '']),
      );
      setApiErrors({
        ...fields,
        form:
          Object.keys(fields).length > 0 ? '' : (body.error?.message ?? 'Something went wrong.'),
      });
    } catch {
      setApiErrors({ form: 'Could not reach the server. Try again.' });
    }
    setSubmitting(false);
  }

  return (
    <form action={signedIn ? undefined : action} onSubmit={signedIn ? submitSignedIn : undefined}>
      <input type="hidden" name="token" value={token} />
      {errors.form && <FormMessage tone="error">{errors.form}</FormMessage>}

      {!signedIn && (
        <>
          <div className="mb-4">
            <Label htmlFor="email">Email</Label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              readOnly
              aria-readonly="true"
              className={`${inputClass} bg-surface-2`}
            />
          </div>
          <Field
            label="Choose a password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            hint="At least 12 characters."
            error={errors.password}
          />
        </>
      )}

      <section aria-labelledby="privacy-heading" className="mb-4">
        <h2 id="privacy-heading" className="mb-1 text-sm font-medium">
          Privacy notice
        </h2>
        <p className="rounded-lg bg-surface-2 p-3 text-sm">{privacyText}</p>
      </section>

      <div className="mb-4">
        <div className="flex items-start gap-3">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            required
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? 'consent-error' : undefined}
            className="mt-1 size-5 shrink-0 accent-accent"
          />
          <label htmlFor="consent" className="text-base">
            I agree to share my training data with {orgName}
          </label>
        </div>
        {errors.consent && (
          <p id="consent-error" role="alert" className="mt-1 text-sm text-danger">
            {errors.consent}
          </p>
        )}
      </div>

      <div className="mb-4">
        <Label htmlFor="timezone">Time zone</Label>
        <select
          id="timezone"
          name="timezone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className={inputClass}
          aria-invalid={errors.timezone ? true : undefined}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        {errors.timezone && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {errors.timezone}
          </p>
        )}
      </div>

      <div className="mb-4">
        <Label htmlFor="preferredUnits">Units</Label>
        <select id="preferredUnits" name="preferredUnits" defaultValue="kg" className={inputClass}>
          <option value="kg">Kilograms (kg)</option>
          <option value="lb">Pounds (lb)</option>
        </select>
      </div>

      <div className="mb-6">
        <Label htmlFor="goals">Goals (optional)</Label>
        <textarea
          id="goals"
          name="goals"
          rows={3}
          maxLength={2000}
          aria-invalid={errors.goals ? true : undefined}
          aria-describedby={errors.goals ? 'goals-error' : undefined}
          className={`${inputClass} py-2`}
        />
        {errors.goals && (
          <p id="goals-error" role="alert" className="mt-1 text-sm text-danger">
            {errors.goals}
          </p>
        )}
      </div>

      <button type="submit" className={buttonClass} disabled={busy}>
        {busy ? 'Joining' : 'Accept invite'}
      </button>
    </form>
  );
}
