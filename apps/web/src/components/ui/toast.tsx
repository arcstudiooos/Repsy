'use client';

import { Toaster as Sonner, toast } from 'sonner';

/** Mount once in the root layout; call `toast(...)` from client code. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        style: {
          background: 'var(--k-surface)',
          color: 'var(--k-ink)',
          border: '1px solid var(--k-input-border)',
          borderRadius: 'var(--k-radius-control)',
        },
      }}
    />
  );
}

export { toast };
