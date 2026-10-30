'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, type ComponentProps } from 'react';
import {
  get,
  useFormContext,
  type FieldError,
  type FieldErrors,
  type RegisterOptions,
} from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EditorValues } from './editorSchema';

const numberField = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

/** Error message at `path`, whether RHF stored it on the field or on an array's `root`. */
export function useError(path: string): string | undefined {
  const {
    formState: { errors },
  } = useFormContext<EditorValues>();
  const e = get(errors as FieldErrors, path) as (FieldError & { root?: FieldError }) | undefined;
  return e?.message ?? e?.root?.message;
}

function ErrorText({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {error}
    </p>
  );
}

export function NumberField({ path, label, step }: { path: string; label: string; step?: string }) {
  const { register } = useFormContext<EditorValues>();
  const id = useId();
  const error = useError(path);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...register(path as never, { setValueAs: numberField })}
      />
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

/** A single-line text input (`multiline` renders a textarea) bound to `path`, with its error. */
export function TextField({
  path,
  label,
  maxLength,
  multiline = false,
  className,
  inputProps,
  options,
}: {
  path: string;
  label: string;
  maxLength: number;
  multiline?: boolean;
  className?: string;
  inputProps?: Pick<
    ComponentProps<'input'>,
    'autoCapitalize' | 'autoComplete' | 'spellCheck' | 'placeholder'
  >;
  options?: RegisterOptions<EditorValues>;
}) {
  const { register } = useFormContext<EditorValues>();
  const id = useId();
  const error = useError(path);
  const shared = {
    id,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    ...register(path as never, options as never),
  };
  return (
    <div className={className ?? 'flex min-w-0 flex-col gap-1'}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea
          rows={2}
          className="block w-full rounded-control border border-input-border bg-surface px-3 py-2 text-base text-ink disabled:opacity-60 aria-invalid:border-danger"
          {...shared}
        />
      ) : (
        <Input {...inputProps} {...shared} />
      )}
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

export type MoveDirection = 'up' | 'down';

/**
 * Keeps keyboard focus on an item after it moves: the same move button when it is still enabled, otherwise the
 * item's other move button (an item moved to the top can't move up again). Keys are stable field-array ids.
 */
export function useMoveFocus() {
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const pending = useRef<{ key: string; dir: MoveDirection } | null>(null);

  // After every render: the moved item has re-rendered at its new position by now.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const same = nodes.current.get(`${p.key}:${p.dir}`);
    const other = nodes.current.get(`${p.key}:${p.dir === 'up' ? 'down' : 'up'}`);
    (same && !same.disabled ? same : other)?.focus();
  });

  const buttonRef = useCallback(
    (key: string, dir: MoveDirection) => (el: HTMLButtonElement | null) => {
      if (el) nodes.current.set(`${key}:${dir}`, el);
      else nodes.current.delete(`${key}:${dir}`);
    },
    [],
  );
  const moved = useCallback((key: string, dir: MoveDirection) => {
    pending.current = { key, dir };
  }, []);
  return { buttonRef, moved };
}

/** "Move {name} up" / "Move {name} down" icon buttons for an item at `index` of `count`. */
export function MoveButtons({
  name,
  index,
  count,
  onMove,
  buttonRef,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (dir: MoveDirection) => void;
  buttonRef: (dir: MoveDirection) => (el: HTMLButtonElement | null) => void;
}) {
  return (
    <>
      <Button
        ref={buttonRef('up')}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Move ${name} up`}
        disabled={index === 0}
        onClick={() => onMove('up')}
      >
        <ChevronUp aria-hidden className="size-5" />
      </Button>
      <Button
        ref={buttonRef('down')}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Move ${name} down`}
        disabled={index >= count - 1}
        onClick={() => onMove('down')}
      >
        <ChevronDown aria-hidden className="size-5" />
      </Button>
    </>
  );
}
