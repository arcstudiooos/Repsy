'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

/** Marks every completion so far as seen, then re-renders the list. */
export function MarkSeenButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/review/seen', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
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
