'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { markReviewed } from '@/lib/checkin-api';

/** Marks one sent check-in reviewed (PRD F14); the client then sees "Your coach reviewed this". */
export function MarkReviewedButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={busy}
      aria-label={`Mark as reviewed: check-in of ${label}`}
      onClick={async () => {
        setBusy(true);
        const res = await markReviewed(id);
        setBusy(false);
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        toast.success('Marked as reviewed. Your client will see it.');
        router.refresh();
      }}
    >
      Mark as reviewed
    </Button>
  );
}
