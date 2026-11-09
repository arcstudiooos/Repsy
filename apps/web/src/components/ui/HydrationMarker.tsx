'use client';

import { useEffect } from 'react';

/**
 * Marks the page interactive. Until then globals.css makes buttons ignore clicks and dims them on a slow load, so a
 * tap on a slow phone is never silently lost (QA 2026-11-06).
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);
  return null;
}
