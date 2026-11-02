'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

export function ArchiveSequence({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      aria-label={`Delete the automation ${name}`}
      onClick={async () => {
        if (!window.confirm(`Delete "${name}"? Clients going through it stop.`)) return;
        const res = await fetch(`/api/v1/automations/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          toast.success('Automation deleted');
          router.push('/app/automations');
          router.refresh();
        } else toast.error("Couldn't delete it. Try again.");
      }}
    >
      Delete
    </Button>
  );
}
