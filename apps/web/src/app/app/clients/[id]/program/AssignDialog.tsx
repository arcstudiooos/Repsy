'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
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
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  mapAssignFieldErrors,
  READINESS_ERROR,
  startDateError,
  todayInZone,
  weekdayError,
  WEEKDAYS,
} from '@/lib/assign-form';

export interface TemplateOption {
  id: string;
  title: string;
  daysPerWeek: number;
}

export interface ClientOption {
  id: string;
  name: string;
  timezone: string;
}

interface Props {
  /** Saved templates the coach can pick from (or the single, fixed one). */
  templates: TemplateOption[];
  /** Active clients the coach can pick from (or the single, fixed one). */
  clients: ClientOption[];
  /** Which side is fixed: the client page fixes the client, the programs list fixes the template. */
  fixed: 'client' | 'template';
  /** The client already has an active assignment, so go straight to the replace confirmation. */
  hasActive?: boolean;
  /** The option lists were cut at the cap. */
  capped?: boolean;
  triggerLabel: string;
  triggerAriaLabel?: string;
  triggerVariant?: 'default' | 'secondary' | 'soft';
}

interface ApiError {
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const READINESS = "I've confirmed this client is ready to start this program.";
const REPLACE_COPY =
  'This update will apply only to upcoming workouts. Completed and already-started workouts will remain unchanged.';

export function AssignDialog({
  templates,
  clients,
  fixed,
  hasActive = false,
  capped = false,
  triggerLabel,
  triggerAriaLabel,
  triggerVariant = 'default',
}: Props) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [submitting, setSubmitting] = useState(false);
  const [templateId, setTemplateId] = useState(
    fixed === 'template' ? (templates[0]?.id ?? '') : '',
  );
  const [clientId, setClientId] = useState(fixed === 'client' ? (clients[0]?.id ?? '') : '');
  const [dateEdited, setDateEdited] = useState(false);
  const [startDate, setStartDate] = useState(() =>
    todayInZone(clients[0] && fixed === 'client' ? clients[0].timezone : 'UTC'),
  );
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [weekdaysTouched, setWeekdaysTouched] = useState(false);
  const [readiness, setReadiness] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const template = templates.find((t) => t.id === templateId);
  const client = clients.find((c) => c.id === clientId);
  const [readinessForced, setReadinessForced] = useState(false);
  const showReadiness = !hasActive || readinessForced;
  // Today in the chosen client's zone: the earliest start the server accepts.
  const minDate = todayInZone(client?.timezone ?? 'UTC');
  const daysError = template ? weekdayError(template.daysPerWeek, weekdays) : null;
  const shownDaysError = errors.weekdays ?? (weekdaysTouched ? daysError : null);

  function clearErrors(...keys: string[]) {
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([k]) => !keys.includes(k))),
    );
  }

  function reset() {
    setStep('details');
    setSubmitting(false);
    setWeekdays([]);
    setWeekdaysTouched(false);
    setReadiness(false);
    setReadinessForced(false);
    setErrors({});
    setFormError(null);
    setDateEdited(false);
    setStartDate(todayInZone(fixed === 'client' && client ? client.timezone : 'UTC'));
    if (fixed === 'client') setTemplateId('');
    else setClientId('');
  }

  function chooseClient(id: string) {
    setClientId(id);
    const next = clients.find((c) => c.id === id);
    if (next && !dateEdited) setStartDate(todayInZone(next.timezone));
  }

  function toggleWeekday(day: number, checked: boolean) {
    setWeekdaysTouched(true);
    clearErrors('weekdays');
    setWeekdays((current) =>
      checked ? [...current, day].sort((a, b) => a - b) : current.filter((d) => d !== day),
    );
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!template) found.template = 'Choose a program.';
    if (!client) found.client = 'Choose a client.';
    const dateError = startDateError(startDate, minDate);
    if (dateError) found.startDate = dateError;
    if (daysError) found.weekdays = daysError;
    if (showReadiness && !readiness) found.readiness = READINESS_ERROR;
    return found;
  }

  async function send(confirmReplace: boolean) {
    if (!template || !client) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/v1/programs/${encodeURIComponent(template.id)}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          clientId: client.id,
          startLocalDate: startDate,
          weekdays,
          readinessConfirmed: showReadiness && readiness,
          confirmReplace,
        }),
      });
      if (res.ok) {
        setOpen(false);
        reset();
        toast.success(confirmReplace ? 'Program replaced' : 'Program assigned');
        if (fixed === 'template') router.push(`/app/clients/${client.id}/program`);
        else router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: ApiError } | null;
      const error = body?.error;
      if (res.status === 409 && error?.code === 'ACTIVE_ASSIGNMENT_EXISTS') {
        setStep('confirm');
        return;
      }
      if (res.status === 422 && error?.fieldErrors) {
        setStep('details');
        const { errors: next, needsReadiness } = mapAssignFieldErrors(error.fieldErrors);
        if (needsReadiness) setReadinessForced(true);
        setErrors(next);
        if (Object.keys(next).length === 0) setFormError(error.message ?? null);
        return;
      }
      setFormError(error?.message ?? 'Could not assign the program. Try again.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setWeekdaysTouched(true);
    if (Object.keys(found).length > 0) return;
    if (hasActive) setStep('confirm');
    else void send(false);
  }

  const id = (name: string) => `${uid}-${name}`;
  const describe = (name: string, hasError: boolean) =>
    hasError ? id(`${name}-error`) : undefined;
  const fieldError = (name: string, message: string | undefined) =>
    message ? (
      <p id={id(`${name}-error`)} className="text-sm text-danger">
        {message}
      </p>
    ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} aria-label={triggerAriaLabel}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign a program</DialogTitle>
          <DialogDescription>
            {step === 'confirm'
              ? REPLACE_COPY
              : 'Pick the program, a start date and the days this client trains.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'confirm' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              {client?.name ?? 'This client'} already has an active program. Replacing it starts{' '}
              {template?.title ?? 'the new program'} on {startDate}.
            </p>
            {formError && (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => setStep('details')}
              >
                Back
              </Button>
              <Button type="button" disabled={submitting} onClick={() => void send(true)}>
                {submitting ? 'Replacing...' : 'Replace program'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {fixed === 'client' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={id('template')} className="text-sm font-medium">
                  Program
                </label>
                <select
                  id={id('template')}
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setWeekdays([]);
                    setWeekdaysTouched(false);
                    clearErrors('template', 'weekdays');
                  }}
                  aria-invalid={errors.template ? true : undefined}
                  aria-describedby={describe('template', Boolean(errors.template))}
                  className="block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink aria-invalid:border-danger"
                >
                  <option value="">Select a program</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                {fieldError('template', errors.template)}
                {capped && <p className="text-sm text-secondary">Showing the first 200</p>}
              </div>
            ) : (
              <>
                <p className="text-sm">
                  <span className="font-medium">Program: </span>
                  {template?.title}
                </p>
                <div className="flex flex-col gap-1">
                  <label htmlFor={id('client')} className="text-sm font-medium">
                    Client
                  </label>
                  <select
                    id={id('client')}
                    value={clientId}
                    onChange={(e) => chooseClient(e.target.value)}
                    aria-invalid={errors.client ? true : undefined}
                    aria-describedby={describe('client', Boolean(errors.client))}
                    className="block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink aria-invalid:border-danger"
                  >
                    <option value="">Select a client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {fieldError('client', errors.client)}
                  {capped && <p className="text-sm text-secondary">Showing the first 200</p>}
                </div>
              </>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor={id('date')} className="text-sm font-medium">
                Start date
              </label>
              <Input
                id={id('date')}
                type="date"
                min={minDate}
                value={startDate}
                onChange={(e) => {
                  setDateEdited(true);
                  setStartDate(e.target.value);
                  clearErrors('startDate');
                }}
                aria-invalid={errors.startDate ? true : undefined}
                aria-describedby={errors.startDate ? id('startDate-error') : undefined}
              />
              {fieldError('startDate', errors.startDate)}
            </div>

            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={shownDaysError ? id('weekdays-error') : undefined}
            >
              <legend className="mb-1 text-sm font-medium">
                Training days
                {template ? ` (choose ${template.daysPerWeek})` : ''}
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WEEKDAYS.map((d) => (
                  <label
                    key={d.value}
                    className="flex min-h-11 items-center gap-2 rounded-control border border-input-border px-3"
                  >
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={weekdays.includes(d.value)}
                      onChange={(e) => toggleWeekday(d.value, e.target.checked)}
                    />
                    {d.long}
                  </label>
                ))}
              </div>
              {shownDaysError && (
                <p id={id('weekdays-error')} className="text-sm text-danger">
                  {shownDaysError}
                </p>
              )}
            </fieldset>

            {showReadiness && (
              <div className="flex flex-col gap-1">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    checked={readiness}
                    onChange={(e) => {
                      setReadiness(e.target.checked);
                      clearErrors('readiness');
                    }}
                    aria-describedby={errors.readiness ? id('readiness-error') : undefined}
                  />
                  {READINESS}
                </label>
                {fieldError('readiness', errors.readiness)}
              </div>
            )}

            {formError && (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {hasActive ? 'Continue' : submitting ? 'Assigning...' : 'Assign program'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
