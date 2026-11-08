'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { SETTABLE_STAGES, STAGE_LABEL, type LifecycleStage } from '@repsy/core/client-stages';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD B20: the coach moves a client between Onboarding, Active and At renewal; Paused and Alumni follow status. */
export function StageSelect({ clientId, stage }: { clientId: string; stage: LifecycleStage }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(stage);
  const fixed = stage === 'paused' || stage === 'alumni';
  if (fixed) {
    return <p className="text-sm text-secondary">Stage: {STAGE_LABEL[stage]}</p>;
  }
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-secondary">
        Stage
      </label>
      <select
        id={id}
        value={value}
        onChange={async (e) => {
          const next = e.target.value as LifecycleStage;
          const before = value;
          setValue(next);
          const res = await call('PUT', `/api/v1/clients/${clientId}/stage`, { stage: next });
          if (res.ok) {
            toast.success(`Stage: ${STAGE_LABEL[next]}`);
            router.refresh();
          } else {
            setValue(before);
            toast.error(res.message);
          }
        }}
        className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
      >
        {SETTABLE_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
