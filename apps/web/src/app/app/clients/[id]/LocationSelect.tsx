'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { setClientLocation } from '@/lib/classes-api';

/** PRD A15: the location a client trains at. Shown only when the workspace has locations. */
export function LocationSelect({
  clientId,
  locationId,
  locations,
  canEdit,
}: {
  clientId: string;
  locationId: string | null;
  locations: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(locationId ?? '');
  if (!canEdit) {
    const name = locations.find((l) => l.id === locationId)?.name;
    return name ? <p className="text-sm text-secondary">Location: {name}</p> : null;
  }
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-secondary">
        Location
      </label>
      <select
        id={id}
        value={value}
        onChange={async (e) => {
          const next = e.target.value;
          const before = value;
          setValue(next);
          const res = await setClientLocation(clientId, next || null);
          if (res.ok) {
            toast.success('Location saved.');
            router.refresh();
          } else {
            setValue(before);
            toast.error(res.message);
          }
        }}
        className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
      >
        <option value="">No location</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
