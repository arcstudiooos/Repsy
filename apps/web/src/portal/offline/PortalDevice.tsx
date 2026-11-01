'use client';

import { useEffect } from 'react';
import { bindOwner, hasDeviceStore } from './db';
import { checkIntegrity } from './integrity';
import { startSyncLoop } from './outbox';

/**
 * The signed-in client's device store, for every portal page (PR #2 review C1, I3). Binds the store to this user and
 * org (wiping another user's offline data first), then runs the outbox sync loop once for the whole portal, so a
 * workout finished offline is sent when the connection returns on any portal page (D-004 #4), and runs the weekly
 * integrity check (PRD D20). Renders nothing.
 */
export function PortalDevice({ userId, orgId }: { userId: string; orgId: string }) {
  useEffect(() => {
    if (!hasDeviceStore()) return;
    let live = true;
    let stop: (() => void) | undefined;
    void bindOwner({ userId, orgId })
      .then(() => {
        if (!live) return;
        stop = startSyncLoop();
        // PRD D20: once a week, the device's workouts are checked against the server's copies.
        if (navigator.onLine) void checkIntegrity().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      stop?.();
    };
  }, [userId, orgId]);
  return null;
}
