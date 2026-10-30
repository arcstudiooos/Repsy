/*
 * Kinetic portal service worker (S3-3, D-004). Scope /portal/. Minimal on purpose:
 * - /_next/static/* is cache-first (content-hashed build assets);
 * - navigations under /portal are network-first; only /portal and the workout pages the app asked for
 *   ("cache-workout" on Start) are stored, and served from the cache when the network fails;
 * - RSC requests and /api/* always pass through and are never cached (writes go through the IndexedDB outbox).
 */
const VERSION = 'v1';
const PAGES = `kinetic-pages-${VERSION}`;
const ASSETS = `kinetic-assets-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('kinetic-') && key !== PAGES && key !== ASSETS) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

const workoutPath = (id) => `/portal/workouts/${id}`;
const isWorkoutPage = (path) => /^\/portal\/workouts\/[0-9a-f-]{36}$/i.test(path);
const isStatic = (u) => new URL(u, self.location.origin).pathname.startsWith('/_next/static/');

/** Pages kept for offline use: the portal home, and workout pages the app asked for (already in the cache). */
async function wanted(path) {
  if (path === '/portal') return true;
  if (!isWorkoutPage(path)) return false;
  return Boolean(await (await caches.open(PAGES)).match(path));
}

async function store(cacheName, url) {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    // Only real pages: a redirect to sign-in or an error page is never kept.
    if (res.ok && !res.redirected) await (await caches.open(cacheName)).put(url, res);
  } catch {
    // Offline: nothing to store now.
  }
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'cache-workout' && typeof msg.sessionId === 'string') {
    const assets = (Array.isArray(msg.assets) ? msg.assets : []).filter(
      (u) => typeof u === 'string' && isStatic(u),
    );
    event.waitUntil(
      Promise.all([
        store(PAGES, workoutPath(msg.sessionId)),
        store(PAGES, '/portal'),
        ...assets.map((u) => caches.match(u).then((hit) => hit || store(ASSETS, u))),
      ]),
    );
  } else if (msg.type === 'uncache-workout' && typeof msg.sessionId === 'string') {
    event.waitUntil(caches.open(PAGES).then((c) => c.delete(workoutPath(msg.sessionId))));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (req.headers.get('RSC') || url.searchParams.has('_rsc')) return;

  if (isStatic(req.url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then(async (res) => {
            if (res.ok) await (await caches.open(ASSETS)).put(req, res.clone());
            return res;
          }),
      ),
    );
    return;
  }

  if (
    req.mode === 'navigate' &&
    (url.pathname === '/portal' || url.pathname.startsWith('/portal/'))
  ) {
    event.respondWith(
      (async () => {
        const path = url.pathname;
        try {
          const res = await fetch(req);
          if (res.ok && !res.redirected && (await wanted(path))) {
            await (await caches.open(PAGES)).put(path, res.clone());
          }
          return res;
        } catch (error) {
          const hit = await (await caches.open(PAGES)).match(path);
          if (hit) return hit;
          throw error;
        }
      })(),
    );
  }
});
