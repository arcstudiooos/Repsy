'use client';

import * as D from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = D.Root;
export const DropdownMenuTrigger = D.Trigger;
export const DropdownMenuGroup = D.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-56 rounded-md border border-border bg-surface p-1 text-ink shadow-e2',
          className,
        )}
        {...props}
      />
    </D.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof D.Item>) {
  return (
    <D.Item
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-base outline-none select-none data-[highlighted]:bg-surface-2 md:min-h-9 [&_svg]:size-4 [&_svg]:text-secondary',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof D.Label>) {
  return <D.Label className={cn('px-3 py-2 text-caption text-secondary', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof D.Separator>) {
  return <D.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}
