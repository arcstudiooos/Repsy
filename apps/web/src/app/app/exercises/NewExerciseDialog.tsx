'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import {
  EQUIPMENT,
  MOVEMENT_TYPES,
  MUSCLE_GROUPS,
  TRACKING_TYPES,
} from '@kinetic/core/exercise-options';
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
import { SELECT_CLASS, TRACKING_LABEL } from './labels';

interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
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

export function NewExerciseDialog() {
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
    const text = (key: string) => String(data.get(key) ?? '');
    try {
      const res = await fetch('/api/v1/exercises', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: text('name'),
          muscleGroup: text('muscleGroup'),
          equipment: text('equipment'),
          movementType: text('movementType'),
          trackingType: text('trackingType'),
          instructions: text('instructions') || undefined,
          mediaUrl: text('mediaUrl') || undefined,
          difficulty: text('difficulty') || null,
          unilateral: data.get('unilateral') === 'on',
          secondaryMuscles: text('secondaryMuscles')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
          cues: text('cues')
            .split('\n')
            .map((v) => v.trim())
            .filter(Boolean),
        }),
      });
      if (res.ok) {
        const created = (await res.json()) as { data: { name: string } };
        setOpen(false);
        toast.success(`${created.data.name} added`);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: ApiError } | null;
      const error = body?.error;
      if (error?.fieldErrors) {
        setFieldErrors(error.fieldErrors);
        if (error.fieldErrors._form) setFormError(error.fieldErrors._form.join(' '));
      } else setFormError(error?.message ?? 'Could not add the exercise. Try again.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const id = (name: string) => `${uid}-${name}`;
  const invalid = (field: string) => (fieldErrors[field] ? true : undefined);
  const describedBy = (field: string) => (fieldErrors[field] ? `${id(field)}-error` : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Add exercise</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add exercise</DialogTitle>
          <DialogDescription>
            Custom exercises are only visible to your organization.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field id={id('name')} label="Name" error={fieldErrors.name?.[0]}>
            <Input
              id={id('name')}
              name="name"
              required
              maxLength={80}
              autoComplete="off"
              aria-invalid={invalid('name')}
              aria-describedby={describedBy('name')}
            />
          </Field>
          <Field id={id('muscleGroup')} label="Muscle group" error={fieldErrors.muscleGroup?.[0]}>
            <select
              id={id('muscleGroup')}
              name="muscleGroup"
              required
              defaultValue={MUSCLE_GROUPS[0]}
              aria-invalid={invalid('muscleGroup')}
              aria-describedby={describedBy('muscleGroup')}
              className={SELECT_CLASS}
            >
              {MUSCLE_GROUPS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field id={id('equipment')} label="Equipment" error={fieldErrors.equipment?.[0]}>
            <select
              id={id('equipment')}
              name="equipment"
              required
              defaultValue={EQUIPMENT[0]}
              aria-invalid={invalid('equipment')}
              aria-describedby={describedBy('equipment')}
              className={SELECT_CLASS}
            >
              {EQUIPMENT.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field id={id('movementType')} label="Movement" error={fieldErrors.movementType?.[0]}>
            <select
              id={id('movementType')}
              name="movementType"
              required
              defaultValue={MOVEMENT_TYPES[0]}
              aria-invalid={invalid('movementType')}
              aria-describedby={describedBy('movementType')}
              className={SELECT_CLASS}
            >
              {MOVEMENT_TYPES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field
            id={id('trackingType')}
            label="What is tracked"
            error={fieldErrors.trackingType?.[0]}
          >
            <select
              id={id('trackingType')}
              name="trackingType"
              required
              defaultValue={TRACKING_TYPES[0]}
              aria-invalid={invalid('trackingType')}
              aria-describedby={describedBy('trackingType')}
              className={SELECT_CLASS}
            >
              {TRACKING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRACKING_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={id('instructions')}
            label="Instructions (optional)"
            error={fieldErrors.instructions?.[0]}
          >
            <textarea
              id={id('instructions')}
              name="instructions"
              rows={3}
              maxLength={2000}
              aria-invalid={invalid('instructions')}
              aria-describedby={describedBy('instructions')}
              className="block w-full rounded-control border border-input-border bg-surface px-3 py-2 text-base text-ink aria-invalid:border-danger"
            />
          </Field>
          <Field
            id={id('mediaUrl')}
            label="Demo video link (optional: YouTube, Vimeo, Instagram or an MP4)"
            error={fieldErrors.mediaUrl?.[0]}
          >
            <Input
              id={id('mediaUrl')}
              name="mediaUrl"
              type="url"
              inputMode="url"
              maxLength={500}
              placeholder="https://"
              aria-invalid={invalid('mediaUrl')}
              aria-describedby={describedBy('mediaUrl')}
            />
          </Field>
          <Field
            id={id('difficulty')}
            label="Difficulty (optional)"
            error={fieldErrors.difficulty?.[0]}
          >
            <select
              id={id('difficulty')}
              name="difficulty"
              defaultValue=""
              aria-invalid={invalid('difficulty')}
              aria-describedby={describedBy('difficulty')}
              className="block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
            >
              <option value="">Not set</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input type="checkbox" name="unilateral" className="size-5 accent-accent" />
            One side at a time (unilateral)
          </label>
          <Field
            id={id('secondaryMuscles')}
            label="Secondary muscles (optional, comma separated)"
            error={fieldErrors.secondaryMuscles?.[0]}
          >
            <input
              id={id('secondaryMuscles')}
              name="secondaryMuscles"
              aria-invalid={invalid('secondaryMuscles')}
              aria-describedby={describedBy('secondaryMuscles')}
              className="block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink aria-invalid:border-danger"
            />
          </Field>
          <Field
            id={id('cues')}
            label="Coaching cues (optional, one per line, up to 6)"
            error={fieldErrors.cues?.[0]}
          >
            <textarea
              id={id('cues')}
              name="cues"
              rows={3}
              aria-invalid={invalid('cues')}
              aria-describedby={describedBy('cues')}
              className="block w-full rounded-control border border-input-border bg-surface px-3 py-2 text-base text-ink aria-invalid:border-danger"
            />
          </Field>
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
              {submitting ? 'Adding...' : 'Add exercise'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
