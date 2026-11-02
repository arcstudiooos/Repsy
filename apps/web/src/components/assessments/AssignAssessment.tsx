'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** Coach side: ask this client for one of the workspace's assessments. */
export function AssignAssessment({
  clientId,
  options,
}: {
  clientId: string;
  options: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  if (options.length === 0) {
    return (
      <p className="text-secondary">
        <Link href="/app/assessments" className="text-accent underline underline-offset-4">
          Create an assessment
        </Link>{' '}
        to ask for posture or mobility photos on a schedule.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-pick`} className="text-sm font-medium">
          Ask for an assessment
        </label>
        <select
          id={`${id}-pick`}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        >
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </div>
      <Button
        disabled={busy || !pick}
        onClick={async () => {
          setBusy(true);
          const res = await call<{ created: boolean }>(
            'POST',
            `/api/v1/clients/${clientId}/assessments`,
            { assessmentId: pick },
          );
          setBusy(false);
          if (res.ok) {
            toast.success(res.data.created ? 'Assessment asked for' : 'Already asked for');
            setPick('');
            router.refresh();
          } else toast.error(res.message);
        }}
      >
        Ask
      </Button>
    </div>
  );
}
