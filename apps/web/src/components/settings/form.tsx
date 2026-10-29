'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

export type FieldErrors = Record<string, string[]>;

interface ApiError {
  code: string;
  message: string;
  fieldErrors?: FieldErrors;
}

export type SaveResult = { ok: true } | { ok: false; message: string; fieldErrors: FieldErrors };

/** PATCH /api/v1/settings from the browser (same-origin, so the CSRF Origin check passes). */
export async function saveSettings(body: unknown): Promise<SaveResult> {
  try {
    const res = await fetch('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const parsed = (await res.json().catch(() => null)) as { error?: ApiError } | null;
    const error = parsed?.error;
    return {
      ok: false,
      message:
        error?.code === 'VALIDATION'
          ? 'Check the highlighted fields and try again.'
          : (error?.message ?? 'Could not save. Try again.'),
      fieldErrors: error?.fieldErrors ?? {},
    };
  } catch {
    return {
      ok: false,
      message: 'Could not reach the server. Check your connection and try again.',
      fieldErrors: {},
    };
  }
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** `aria-describedby` / `aria-invalid` props for a control wired to a `Field`. */
export const fieldAria = (id: string, error: string | undefined, hasHint = false) => ({
  'aria-invalid': error ? (true as const) : undefined,
  'aria-describedby':
    [hasHint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined,
});

/** Native select styled like `Input`. */
export function Select({ className = '', ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={`block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink disabled:opacity-60 aria-invalid:border-danger ${className}`}
      {...props}
    />
  );
}

const NO_ZONES: string[] = [];
let zoneList: string[] | undefined;
const subscribeNever = () => () => {};
const clientZones = () => (zoneList ??= ['UTC', ...Intl.supportedValuesOf('timeZone')]);

/** IANA zone names for a `<datalist>`; empty on the server so server and client markup agree. */
export function useTimezones(): string[] {
  return useSyncExternalStore(subscribeNever, clientZones, () => NO_ZONES);
}

/**
 * One settings section = one form = one PATCH. `buildPatch` turns the submitted form
 * into the request body; `children` receives the server's field errors (keys like `org.name`).
 */
export function SectionForm({
  title,
  description,
  buildPatch,
  children,
  readOnlyNote,
}: {
  title: string;
  description?: string;
  buildPatch: (data: FormData) => unknown;
  children: (errors: FieldErrors, uid: string) => ReactNode;
  /** When set the form is display-only: no Save button, this note explains why. */
  readOnlyNote?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    setSaving(true);
    const result = await saveSettings(buildPatch(new FormData(event.currentTarget)));
    setSaving(false);
    if (result.ok) {
      toast.success(`${title} saved`);
      router.refresh();
      return;
    }
    setErrors(result.fieldErrors);
    setFormError(result.message);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {children(errors, uid)}
          {readOnlyNote && <p className="text-sm text-secondary">{readOnlyNote}</p>}
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          {!readOnlyNote && (
            <div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
