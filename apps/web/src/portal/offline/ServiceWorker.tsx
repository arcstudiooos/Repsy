'use client';

import { useEffect, useState } from 'react';
import { registerServiceWorker } from './registerSw';

/**
 * Registers the portal service worker once the portal shell has loaded.
 *
 * PRD M11: an update never interrupts the client. When a new version takes over while this tab is open, a quiet
 * notice offers a refresh; it never reloads by itself, so a workout in progress carries on (sets are saved on the
 * device and sent by the outbox either way).
 */
export function ServiceWorker() {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    registerServiceWorker();
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // The first install also changes the controller: only a replacement counts as an update.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onChange = () => {
      if (hadController) setUpdated(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);
  if (!updated) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-card border border-border bg-surface p-3 text-sm text-ink shadow-e2 md:bottom-6"
    >
      <p className="flex-1">
        Repsy has been updated. Refresh when you are ready. Anything you logged is saved.
      </p>
      <button
        type="button"
        className="min-h-11 rounded-control px-3 font-semibold text-brand"
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="min-h-11 rounded-control px-2 text-secondary"
        onClick={() => setUpdated(false)}
      >
        ×
      </button>
    </div>
  );
}
