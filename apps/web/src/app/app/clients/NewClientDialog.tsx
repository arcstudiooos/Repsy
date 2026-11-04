'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { sendInvite } from '@/lib/invite-api';

interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

const DEFAULT_LIMIT = 30;

/** The limit comes from `error.details.limit` (CLIENT_LIMIT_REACHED), never parsed out of the message. */
function limitMessage(details: ApiError['details']): string {
  const limit = details?.limit;
  const n = typeof limit === 'number' && Number.isInteger(limit) ? limit : DEFAULT_LIMIT;
  return `Pilot access includes up to ${n} active clients.`;
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function NewClientDialog({
  intakeForms = [],
}: {
  /** PRD B12: intake forms the coach can send with the invite. */
  intakeForms?: { id: string; title: string }[];
} = {}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setFieldErrors({});
    setFormError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reset();
    setSubmitting(true);
    const data = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: String(data.get('name') ?? ''),
          email: String(data.get('email') ?? ''),
          goals: String(data.get('goals') ?? '') || undefined,
        }),
      });
      if (res.ok) {
        const created = (await res.json()) as { data: { id: string; name: string } };
        const wantInvite = data.get('sendInvite') === 'on';
        const invited = wantInvite ? await sendInvite(created.data.id) : null;
        const intake = String(data.get('intake') ?? '');
        // PRD B12: waits in the client's portal until they join.
        if (intake) {
          await fetch(`/api/v1/clients/${created.data.id}/forms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ templateId: intake }),
          }).catch(() => null);
        }
        setOpen(false);
        if (invited && !invited.ok) {
          toast.error(
            "Client added, but the invite couldn't be sent. You can send it from their page.",
          );
        } else {
          toast.success(`${created.data.name} added`);
        }
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: ApiError } | null;
      const error = body?.error;
      if (error?.code === 'CLIENT_LIMIT_REACHED') setFormError(limitMessage(error.details));
      else if (error?.code === 'EMAIL_TAKEN') setFieldErrors({ email: [error.message] });
      else if (error?.fieldErrors) {
        setFieldErrors(error.fieldErrors);
        if (error.fieldErrors._form) setFormError(error.fieldErrors._form.join(' '));
      } else setFormError(error?.message ?? 'Could not add the client. Try again.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const goalsId = `${uid}-goals`;
  const invalid = (field: string) => (fieldErrors[field] ? true : undefined);
  const describedBy = (id: string, field: string) =>
    fieldErrors[field] ? `${id}-error` : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Add client</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add client</DialogTitle>
          <DialogDescription>
            We will email an invitation so they can set up their account.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field id={nameId} label="Name" error={fieldErrors.name?.[0]}>
            <Input
              id={nameId}
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              aria-invalid={invalid('name')}
              aria-describedby={describedBy(nameId, 'name')}
            />
          </Field>
          <Field id={emailId} label="Email" error={fieldErrors.email?.[0]}>
            <Input
              id={emailId}
              name="email"
              type="email"
              required
              autoComplete="off"
              aria-invalid={invalid('email')}
              aria-describedby={describedBy(emailId, 'email')}
            />
          </Field>
          <Field id={goalsId} label="Goals (optional)" error={fieldErrors.goals?.[0]}>
            <textarea
              id={goalsId}
              name="goals"
              rows={3}
              maxLength={2000}
              aria-invalid={invalid('goals')}
              aria-describedby={describedBy(goalsId, 'goals')}
              className="block w-full rounded-control border border-input-border bg-surface px-3 py-2 text-base text-ink aria-invalid:border-danger"
            />
          </Field>
          {intakeForms.length > 0 && (
            <Field id={`${uid}-intake`} label="Intake form (optional)">
              <select
                id={`${uid}-intake`}
                name="intake"
                defaultValue=""
                className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
              >
                <option value="">None</option>
                {intakeForms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input
              type="checkbox"
              name="sendInvite"
              defaultChecked
              className="size-5 accent-accent"
            />
            Send invite email now
          </label>
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
