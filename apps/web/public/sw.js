/*
 * Kinetic portal service worker (S3-3, D-004). Scope /portal (the home and every page under it). Minimal:
 * - /_next/static/* is cache-first (content-hashed build assets);
 * - navigations under /portal are network-first; only /portal and the workout pages the app asked for
 *   ("cache-workout" on Start) are stored, and served from the cache when the network fails;
 * - RSC requests and /api/* always pass through and are never cached (writes go through the IndexedDB outbox).
 *
 * Whose pages (PR #2 review C1): stored pages are one signed-in user's, keyed by path. The worker can't check a
 * session offline (the cookie is HttpOnly and the server is unreachable), so the pages are bound to the user by the
 * app instead: a cached page is only ever served when the network fails (online, every navigation goes to the
 * server, which redirects a signed-out visitor); sign-out deletes the kinetic-pages-* caches with the IndexedDB
 * store (SignOutButton, wipeDevice); and every portal load binds the store to the signed-in user, deleting both when
 * another user's data is found (bindOwner). Build assets hold no user data and are kept. A session that ended without
 * this device signing out (expiry, a password reset, "sign out all other devices") is caught the next time the
 * device is online: a portal navigation that the server redirects or refuses deletes the stored pages (PR #2
 * re-review residual 1).
 */
// Stored pages are the user's and outlive a deploy (an in-progress workout must still open offline). Build assets are
// per build: the app registers this worker as /sw.js?build=<id>, so each deploy installs a new worker with its own
// asset cache, and activation drops the old ones (PR #2 review follow-up: they grew with every deploy).
const PAGES = 'kinetic-pages-v1';
const BUILD = (new URL(self.location.href).searchParams.get('build') || 'dev')
  .replace(/[^A-Za-z0-9_-]/g, '')
  .slice(0, 40);
const ASSETS = `kinetic-assets-${BUILD}`;
const ASSET_PREFIX = 'kinetic-assets-';
// A stored workout page not opened again in this long (an abandoned session) is dropped on the next activation.
const STALE_PAGE_MS = 14 * 24 * 60 * 60 * 1000;

self.addEventListener('install', () => self.skipWaiting());

/**
 * On activation: drops workout pages stored longer ago than STALE_PAGE_MS; carries over from older asset caches only
 * what the remaining stored pages reference (so they still hydrate offline), then deletes those caches and any other
 * stale kinetic-* cache.
 */
async function tidyCaches() {
  const pages = await caches.open(PAGES);
  const needed = new Set();
  const now = Date.now();
  for (const req of await pages.keys()) {
    const res = await pages.match(req);
    if (!res) continue;
    const path = new URL(req.url).pathname;
    const stored = Date.parse(res.headers.get('date') || '');
    if (isWorkoutPage(path) && Number.isFinite(stored) && now - stored > STALE_PAGE_MS) {
      await pages.delete(req);
      continue;
    }
    for (const u of assetsIn(await res.clone().text())) needed.add(u);
  }
  const assets = await caches.open(ASSETS);
  for (const key of await caches.keys()) {
    if (!key.startsWith('kinetic-') || key === PAGES || key === ASSETS) continue;
    if (key.startsWith(ASSET_PREFIX)) {
      const old = await caches.open(key);
      for (const req of await old.keys()) {
        const path = new URL(req.url).pathname;
        if (!needed.has(path) || (await assets.match(req))) continue;
        const hit = await old.match(req);
        if (hit) await assets.put(req, hit);
      }
    }
    await caches.delete(key);
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await tidyCaches();
      } catch {
        // Storage trouble: the worker still takes over; the next activation tidies.
      }
      await self.clients.claim();
    })(),
  );
});

const SESSION_ID = /^[0-9a-f-]{36}$/i;
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
    if (!res.ok || res.redirected) return;
    if (cacheName === PAGES) await storeAssetsOf(await res.clone().text());
    await (await caches.open(cacheName)).put(url, res);
  } catch {
    // Offline: nothing to store now.
  }
}

/** The build asset paths a page's HTML references. */
const assetsIn = (html) => new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);

/** Every build asset a stored page references (scripts, styles, fonts), so the page hydrates offline. */
async function storeAssetsOf(html) {
  const found = assetsIn(html);
  const cache = await caches.open(ASSETS);
  await Promise.all(
    [...found].map(async (u) => {
      if (!(await cache.match(u))) await store(ASSETS, u);
    }),
  );
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (typeof msg.sessionId !== 'string' || !SESSION_ID.test(msg.sessionId)) return;
  if (msg.type === 'cache-workout') {
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
  } else if (msg.type === 'uncache-workout') {
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
        let res;
        try {
          res = await fetch(req);
        } catch (error) {
          const hit = await (await caches.open(PAGES)).match(path);
          if (hit) return hit;
          throw error;
        }
        // Online from here: the server's answer is always served, never a cached page (PR #2 re-review M1).
        try {
          if (res.type === 'opaqueredirect' || res.redirected || res.status === 401) {
            // Signed out elsewhere, or the session ended: the pages kept for it go.
            for (const key of await caches.keys()) {
              if (key.startsWith('kinetic-pages-')) await caches.delete(key);
            }
          } else if (res.ok && (await wanted(path))) {
            await (await caches.open(PAGES)).put(path, res.clone());
          }
        } catch {
          // Storage failed (quota): the fresh page is still served.
        }
        return res;
      })(),
    );
  }
});
