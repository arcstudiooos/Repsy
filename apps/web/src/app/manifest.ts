import type { MetadataRoute } from 'next';

/**
 * Web app manifest (PRD L1): the client portal installs to the home screen and opens standalone, with offline
 * logging from the portal service worker (D-004). The icon is Repsy's; a per-workspace icon (the coach's logo)
 * needs a per-workspace manifest and waits for that.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Repsy.fit',
    short_name: 'Repsy',
    description: 'Your training plan, workouts and check-ins from your coach.',
    start_url: '/portal',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f7fb',
    theme_color: '#4f46e5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
