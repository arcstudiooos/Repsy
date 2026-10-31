'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Pin } from 'lucide-react';
import type { ClientContext } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { updateContext } from '@/lib/note-api';

const FIELDS = [
  ['goals', 'Goals', 'What they want to achieve, and by when.', 2000],
  ['motivation', 'Why they came', 'What made them start, in their words.', 1000],
  ['scheduleNotes', 'Schedule', 'Days, times and travel that affect training.', 1000],
  ['equipmentNotes', 'Equipment', 'Where they train and with what.', 1000],
  ['preferences', 'Preferences', 'Likes, dislikes, how they like feedback.', 1000],
] as const;
type Field = (typeof FIELDS)[number][0];

function EditContext({ context }: { context: ClientContext }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Field, string>>(() => ({
    goals: context.goals ?? '',
    motivation: context.motivation ?? '',
    scheduleNotes: context.scheduleNotes ?? '',
    equipmentNotes: context.equipmentNotes ?? '',
    preferences: context.preferences ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          Edit context
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Client context</DialogTitle>
          <DialogDescription>
            Only coaches see this. It shows on every page of this client.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await updateContext(context.clientId, values);
            setBusy(false);
            if (!res.ok) {
              const next: Record<string, string> = {};
              for (const [k, v] of Object.entries(res.fieldErrors ?? {})) if (v[0]) next[k] = v[0];
              if (Object.keys(next).length === 0) toast.error(res.message);
              setErrors(next);
              return;
            }
            setErrors({});
            setOpen(false);
            toast.success('Context saved.');
            router.refresh();
          }}
        >
          {FIELDS.map(([key, label, hint, max]) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${key}`} className="text-sm font-medium">
                {label}
              </label>
              <textarea
                id={`${id}-${key}`}
                rows={2}
                maxLength={max}
                value={values[key]}
                placeholder={hint}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                aria-invalid={errors[key] ? true : undefined}
                aria-describedby={errors[key] ? `${id}-${key}-e` : undefined}
                className="rounded-control border border-input-border bg-surface px-3 py-2 text-base aria-invalid:border-danger"
              />
              {errors[key] && (
                <p id={`${id}-${key}-e`} role="alert" className="text-sm text-danger">
                  {errors[key]}
                </p>
              )}
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save context'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The client context card (PRD B7), pinned above every client tab so coaching never starts from zero. Coaches only.
 */
export function ContextCard({ context }: { context: ClientContext }) {
  const filled = FIELDS.filter(([key]) => context[key]);
  const empty = filled.length === 0 && context.pinnedNotes.length === 0;
  return (
    <section
      aria-labelledby="context-heading"
      className="rounded-card border border-input-border bg-surface p-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="context-heading" className="text-base font-semibold">
          Client context
        </h2>
        <EditContext context={context} />
      </div>
      {empty ? (
        <p className="text-sm text-secondary">
          Add what matters to this client (goals, why they came, schedule, equipment) so it is in
          front of you every time.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filled.length > 0 && (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {filled.map(([key, label]) => (
                <div key={key}>
                  <dt className="text-secondary">{label}</dt>
                  <dd className="line-clamp-3 whitespace-pre-wrap">{context[key]}</dd>
                </div>
              ))}
            </dl>
          )}
          {context.pinnedNotes.length > 0 && (
            <ul aria-label="Pinned notes" className="flex flex-col gap-1 text-sm">
              {context.pinnedNotes.map((n) => (
                <li key={n.id} className="flex gap-2">
                  <Pin aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span className="whitespace-pre-wrap">{n.body}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
