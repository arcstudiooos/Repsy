'use client';

import { useSyncExternalStore } from 'react';

/** A clock that ticks every 30 s; the snapshot is the current 30-second slot, so renders stay pure. */
function subscribe(onChange: () => void) {
  const t = setInterval(onChange, 30_000);
  return () => clearInterval(t);
}
const slot = () => Math.floor(Date.now() / 30_000);

/** Minutes since `since` (ISO), at least 1; "–" when there is no start time. */
export function ElapsedMinutes({ since }: { since: string | null }) {
  const now = useSyncExternalStore(subscribe, slot, () => 0) * 30_000;
  if (!since || now === 0) return <>–</>;
  return <>{Math.max(1, Math.round((now - Date.parse(since)) / 60_000))} min</>;
}
