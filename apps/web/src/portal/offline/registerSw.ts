'use client';

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

/** This build's id (next.config.ts): the worker names its asset cache after it. */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

/**
 * Registers the portal service worker (S3-3). Does nothing where service workers are unavailable. The script URL
 * carries the build id, so each deploy installs a new worker even though `sw.js` itself is unchanged.
 */
export function registerServiceWorker(): void {
  if (!supported()) return;
  void navigator.serviceWorker
    .register(`/sw.js?build=${encodeURIComponent(BUILD_ID)}`, { scope: '/portal' })
    .catch(() => undefined);
}

async function post(message: Record<string, unknown>): Promise<void> {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  reg?.active?.postMessage(message);
}

/**
 * Asks the worker to keep this workout page, the portal home and the build assets this page loaded, so the workout
 * opens offline later.
 */
export function cacheWorkoutPage(sessionId: string): void {
  const assets = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => new URL(u, location.origin).pathname.startsWith('/_next/static/'));
  void post({ type: 'cache-workout', sessionId, assets });
}

export function uncacheWorkoutPage(sessionId: string): void {
  void post({ type: 'uncache-workout', sessionId });
}

/** PRD D4: asks the worker to keep the next 7 days of workouts, so any of them opens and starts offline. */
export function keepUpcomingWorkouts(sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  void post({ type: 'keep-upcoming', sessionIds });
}
