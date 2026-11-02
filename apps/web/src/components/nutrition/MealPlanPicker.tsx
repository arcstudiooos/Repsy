'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** Coach side: which meal plan the client follows (PRD G8). */
export function MealPlanPicker({
  clientId,
  current,
  plans,
}: {
  clientId: string;
  current: string | null;
  plans: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [pick, setPick] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-plan`} className="text-sm font-medium">
          Meal plan
        </label>
        <select
          id={`${id}-plan`}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        >
          <option value="">No meal plan</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <Button
        disabled={busy || pick === (current ?? '')}
        onClick={async () => {
          setBusy(true);
          const res = await call('PUT', `/api/v1/clients/${clientId}/meal-plan`, {
            mealPlanId: pick || null,
          });
          setBusy(false);
          if (res.ok) {
            toast.success(pick ? 'Meal plan given' : 'Meal plan removed');
            router.refresh();
          } else toast.error(res.message);
        }}
      >
        Save meal plan
      </Button>
    </div>
  );
}
