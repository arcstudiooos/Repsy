'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { ClientView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { todayInZone } from '@/lib/assign-form';
import { changeResumeDate, pauseClient, resumeClient } from '@/lib/pause-api';
import type { ApiCall } from '@/lib/workout-api';
import { formatDate } from '../StatusBadge';

/** D-003, verbatim. */
export const PAUSE_TITLE = "Pause client's program?";
export const PAUSE_BODY =
  "Upcoming workouts will move forward by the pause duration. Completed workouts and existing progress will remain unchanged. The paused period won't affect adherence calculations.";

const DAY_MS = 86_400_000;
const addDays = (localDate: string, days: number) =>
  new Date(new Date(`${localDate}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

type Errors = { startLocalDate?: string; resumeLocalDate?: string; form?: string };

function errorsOf(res: Extract<ApiCall<unknown>, { ok: false }>): Errors {
  const fe = res.status === 422 ? res.fieldErrors : undefined;
  const start = fe?.startLocalDate?.[0];
  const resume = fe?.resumeLocalDate?.[0];
  return start || resume
    ? { startLocalDate: start, resumeLocalDate: resume }
    : { form: res.message };
}

/** Coach controls for pausing and resuming a client's program (S3-5). Only active and paused clients get them. */
export function PauseControls({
  client,
}: {
  client: Pick<ClientView, 'id' | 'name' | 'status' | 'timezone' | 'pause'>;
}) {
  const router = useRouter();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [dialog, setDialog] = useState<'pause' | 'change' | 'resume' | null>(null);
  const [start, setStart] = useState('');
  const [resume, setResume] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  if (client.status !== 'active' && client.status !== 'paused') return null;
  const today = todayInZone(client.timezone);

  function open(which: 'pause' | 'change' | 'resume') {
    setErrors({});
    if (which === 'pause') {
      setStart(today);
      setResume(addDays(today, 7));
    } else if (which === 'change') {
      setResume(client.pause?.resumeLocalDate ?? addDays(today, 7));
    }
    setDialog(which);
  }

  async function run(call: () => Promise<ApiCall<ClientView>>, success: string) {
    setBusy(true);
    setErrors({});
    const res = await call();
    setBusy(false);
    if (res.ok) {
      setDialog(null);
      toast.success(success);
      router.refresh();
    } else {
      setErrors(errorsOf(res));
    }
  }

  const fieldError = (name: 'startLocalDate' | 'resumeLocalDate') =>
    errors[name] ? (
      <p id={id(`${name}-error`)} className="text-sm text-danger">
        {errors[name]}
      </p>
    ) : null;
  const formError = errors.form ? (
    <p role="alert" className="text-sm text-danger">
      {errors.form}
    </p>
  ) : null;

  const dateField = (
    name: 'startLocalDate' | 'resumeLocalDate',
    label: string,
    value: string,
    set: (v: string) => void,
    min: string,
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id(name)} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id(name)}
        type="date"
        required
        min={min}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setErrors((prev) => ({ ...prev, [name]: undefined }));
        }}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? id(`${name}-error`) : undefined}
      />
      {fieldError(name)}
    </div>
  );

  const close = (next: boolean) => {
    if (!next) setDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {client.status === 'paused' && client.pause && (
        <p>Paused until {formatDate(client.pause.resumeLocalDate)}</p>
      )}
      {client.status === 'active' ? (
        <Button variant="secondary" onClick={() => open('pause')}>
          Pause program
        </Button>
      ) : (
        client.pause && (
          <>
            <Button variant="secondary" onClick={() => open('change')}>
              Change resume date
            </Button>
            <Button variant="secondary" onClick={() => open('resume')}>
              Resume now
            </Button>
          </>
        )
      )}

      <Dialog open={dialog === 'pause'} onOpenChange={close}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void run(
                () => pauseClient(client.id, { startLocalDate: start, resumeLocalDate: resume }),
                'Program paused',
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>{PAUSE_TITLE}</DialogTitle>
              <DialogDescription>{PAUSE_BODY}</DialogDescription>
            </DialogHeader>
            {dateField('startLocalDate', 'Pause starts', start, setStart, today)}
            {dateField('resumeLocalDate', 'Expected resume date', resume, setResume, today)}
            {formError}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                Pause program
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'change'} onOpenChange={close}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void run(() => changeResumeDate(client.id, resume), 'Resume date changed');
            }}
          >
            <DialogHeader>
              <DialogTitle>Change resume date</DialogTitle>
              <DialogDescription>
                Upcoming workouts move with the new date. Completed workouts stay as they are.
              </DialogDescription>
            </DialogHeader>
            {dateField('resumeLocalDate', 'Expected resume date', resume, setResume, today)}
            {formError}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                Save date
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'resume'} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resume {client.name}&apos;s program today?</DialogTitle>
            <DialogDescription>Upcoming workouts move back to start today.</DialogDescription>
          </DialogHeader>
          {formError}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => resumeClient(client.id), 'Program resumed')}
            >
              Resume now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
