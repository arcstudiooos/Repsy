'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { hasDeviceStore } from './db';
import { subscribe, type SyncState } from './outbox';

/**
 * The session's outbox state, live; null until the first read (or where there is no device store). The sync loop
 * itself runs for the whole portal (`PortalDevice` in the portal layout), not per page.
 */
export function useSyncStatus(sessionId: string, enabled = true): SyncState | null {
  const [state, setState] = useState<SyncState | null>(null);
  useEffect(() => {
    if (!enabled || !hasDeviceStore()) return;
    return subscribe(sessionId, setState);
  }, [sessionId, enabled]);
  return state;
}

const onlineSubscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** `navigator.onLine`, live. Online during server rendering. */
export const useOnline = (): boolean =>
  useSyncExternalStore(
    onlineSubscribe,
    () => navigator.onLine,
    () => true,
  );
