'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { duplicateProgram, setProgramArchived } from '@/lib/program-api';

/** Duplicate and archive or restore one template (PRD C13). */
export function ProgramActions({
  id,
  title,
  archived,
}: {
  id: string;
  title: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {!archived && (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          aria-label={`Duplicate ${title}`}
          onClick={async () => {
            setBusy(true);
            const res = await duplicateProgram(id);
            setBusy(false);
            if (!res.ok) {
              toast.error(res.message);
              return;
            }
            toast.success(`Created "${res.data.title}".`);
            router.push(`/app/programs/${res.data.id}/edit`);
          }}
        >
          Duplicate
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        aria-label={`${archived ? 'Restore' : 'Archive'} ${title}`}
        onClick={async () => {
          setBusy(true);
          const res = await setProgramArchived(id, !archived);
          setBusy(false);
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(
            archived
              ? `Restored "${title}".`
              : `Archived "${title}". Clients already on it keep their program.`,
          );
          router.refresh();
        }}
      >
        {archived ? 'Restore' : 'Archive'}
      </Button>
    </div>
  );
}
