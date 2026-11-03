'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { send } from '@/lib/billing-api';

/** PRD M12: the platform admin marks a workspace lapsed (read-only) or restores it. */
export function LapseControl({ orgId, name }: { orgId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function set(lapsed: boolean) {
    setBusy(true);
    const res = await send('POST', `/api/v1/admin/workspaces/${orgId}/lapse`, { lapsed });
    setBusy(false);
    setMessage(
      res.ok ? (lapsed ? `${name} is now read-only.` : `${name} is restored.`) : res.message,
    );
  }
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void set(true)}>
        Mark lapsed
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void set(false)}>
        Restore
      </Button>
      {message && (
        <span role="status" className="text-secondary">
          {message}
        </span>
      )}
    </span>
  );
}
