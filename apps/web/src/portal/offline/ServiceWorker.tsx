'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from './registerSw';

/** Registers the portal service worker once the portal shell has loaded. Renders nothing. */
export function ServiceWorker() {
  useEffect(() => registerServiceWorker(), []);
  return null;
}
