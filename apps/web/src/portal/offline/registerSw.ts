'use client';

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

/** Registers the portal service worker (S3-3). Does nothing where service workers are unavailable. */
export function registerServiceWorker(): void {
  if (!supported()) return;
  void navigator.serviceWorker.register('/sw.js', { scope: '/portal' }).catch(() => undefined);
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
