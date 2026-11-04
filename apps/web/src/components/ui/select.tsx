'use client';

import * as S from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: ReactNode;
}

/**
 * Radix select, styled like the inputs. Radix forbids empty item values, so "" (all / none) is mapped to a
 * sentinel internally and back again; callers keep using "".
 */
const EMPTY = '__empty__';

export function Select({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  id,
  className,
  disabled,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  /** Accessible name, when there is no visible <label htmlFor={id}>. */
  label?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <S.Root
      value={value === '' ? EMPTY : value}
      onValueChange={(v) => onValueChange(v === EMPTY ? '' : v)}
      disabled={disabled}
    >
      <S.Trigger
        id={id}
        aria-label={label}
        className={cn(
          'inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-control border border-input-border bg-surface px-3 text-base text-ink data-[placeholder]:text-secondary sm:w-auto',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown aria-hidden className="size-4 text-secondary" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface p-1 text-ink shadow-e2"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value || EMPTY}
                value={o.value === '' ? EMPTY : o.value}
                className="relative flex min-h-11 cursor-pointer items-center rounded-sm py-2 pr-3 pl-8 text-base outline-none select-none data-[highlighted]:bg-surface-2 md:min-h-9"
              >
                <S.ItemIndicator className="absolute left-2">
                  <Check aria-hidden className="size-4 text-accent" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
