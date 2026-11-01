'use client';

import { useId, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD D13: lets clients start this template's workouts as extra workouts. */
export function ShareWithClients({ programId, initial }: { programId: string; initial: boolean }) {
  const id = useId();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mb-4 flex items-start gap-3 rounded-card bg-surface p-4 shadow-card">
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-5 shrink-0 accent-accent"
        checked={on}
        disabled={busy}
        aria-describedby={`${id}-hint`}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          setBusy(true);
          const res = await call('PUT', `/api/v1/programs/${programId}/shared`, {
            sharedWithClients: next,
          });
          setBusy(false);
          if (!res.ok) {
            setOn(!next);
            toast.error(res.message);
            return;
          }
          toast.success(next ? 'Shared with your clients' : 'No longer shared');
        }}
      />
      <div>
        <label htmlFor={id} className="font-medium">
          Share with clients as extra workouts
        </label>
        <p id={`${id}-hint`} className="text-sm text-secondary">
          Clients can start any day of this template as an extra workout. It counts toward their
          history, not their adherence, and always uses your latest saved version.
        </p>
      </div>
    </div>
  );
}

/** PRD C20: an owner or admin publishes this template to every coach on the team. */
export function HouseTemplate({ programId, initial }: { programId: string; initial: boolean }) {
  const id = useId();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mb-4 flex items-start gap-3 rounded-card bg-surface p-4 shadow-card">
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-5 shrink-0 accent-accent"
        checked={on}
        disabled={busy}
        aria-describedby={`${id}-hint`}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          setBusy(true);
          const res = await call('PUT', `/api/v1/programs/${programId}/house`, { house: next });
          setBusy(false);
          if (!res.ok) {
            setOn(!next);
            toast.error(res.message);
            return;
          }
          toast.success(next ? 'Published to the team' : 'No longer a house template');
        }}
      />
      <div>
        <label htmlFor={id} className="font-medium">
          House template for the whole team
        </label>
        <p id={`${id}-hint`} className="text-sm text-secondary">
          Every coach sees and assigns it. Only you and other admins edit it; coaches duplicate it
          to make their own version.
        </p>
      </div>
    </div>
  );
}
