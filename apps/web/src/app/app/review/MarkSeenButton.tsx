'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

/** Marks the completions on this list as seen (through the list's read time), then re-renders it. */
export function MarkSeenButton({ through }: { through: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/review/seen', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ through }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // The button leaves with the list it cleared: announce the result.
      toast.success('Marked as seen');
      router.refresh();
    } catch {
      toast.error("Couldn't mark the list as seen. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="secondary" onClick={onClick} disabled={busy}>
      {busy ? 'Saving…' : 'Mark all as seen'}
    </Button>
  );
}
