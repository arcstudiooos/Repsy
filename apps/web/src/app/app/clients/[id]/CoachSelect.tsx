'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD A11: the client's primary coach, and moving them to another coach (history and messages go with them). */
export function CoachSelect({
  clientId,
  coachUserId,
  coaches,
  canTransfer,
}: {
  clientId: string;
  coachUserId: string;
  coaches: { userId: string; name: string }[];
  canTransfer: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(coachUserId);
  const name = coaches.find((c) => c.userId === coachUserId)?.name;
  if (!canTransfer) return name ? <p className="text-sm text-secondary">Coach: {name}</p> : null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-secondary">
        Coach
      </label>
      <select
        id={id}
        value={value}
        onChange={async (e) => {
          const next = e.target.value;
          const before = value;
          setValue(next);
          const res = await call('PUT', `/api/v1/clients/${clientId}/coach`, { coachUserId: next });
          if (res.ok) {
            toast.success(
              `Moved to ${coaches.find((c) => c.userId === next)?.name ?? 'the new coach'}`,
            );
            router.refresh();
          } else {
            setValue(before);
            toast.error(res.message);
          }
        }}
        className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
      >
        {coaches.map((c) => (
          <option key={c.userId} value={c.userId}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
