import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * The portal service worker's cache naming and activation (public/sw.js), run in a sandbox with an in-memory Cache
 * Storage: each build has its own asset cache, and activating a new build carries over only what stored pages need.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL('../../../public/sw.js', import.meta.url)),
  'utf8',
);
const ORIGIN = 'https://repsy.test';
const DAY_MS = 86_400_000;
const WORKOUT = '/portal/workouts/11111111-1111-4111-8111-111111111111';
const OLD_WORKOUT = '/portal/workouts/22222222-2222-4222-8222-222222222222';

/** A Cache Storage keyed by cache name, then by URL. */
function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const urlOf = (r: Request | string) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      keys: async () => [...store.keys()].map((u) => new Request(u)),
      match: async (r: Request | string) => store.get(urlOf(r))?.clone(),
      put: async (r: Request | string, res: Response) => void store.set(urlOf(r), res.clone()),
      delete: async (r: Request | string) => store.delete(urlOf(r)),
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (r: Request | string) => {
        for (const store of stores.values()) {
          const hit = store.get(urlOf(r));
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
  };
}

/** Loads sw.js as build `build` against `caches`, and returns its activate handler. */
function loadWorker(
  build: string,
  caches: ReturnType<typeof memoryCaches>,
  fetchImpl: typeof fetch = fetch,
) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const self = {
    location: new URL(`/sw.js?build=${build}`, ORIGIN),
    addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  runInNewContext(SOURCE, {
    self,
    caches: caches.api,
    URL,
    Request,
    Response,
    fetch: fetchImpl,
    Date,
    Set,
  });
  return {
    message: async (data: unknown) => {
      let done: Promise<unknown> = Promise.resolve();
      handlers.message!({ data, waitUntil: (p: Promise<unknown>) => (done = p) });
      await done;
    },
    activate: async () => {
      let done: Promise<unknown> = Promise.resolve();
      handlers.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) });
      await done;
    },
  };
}

const page = (assets: string[], storedAt: Date) =>
  new Response(`<html>${assets.map((a) => `<script src="${a}"></script>`).join('')}</html>`, {
    headers: { 'content-type': 'text/html', date: storedAt.toUTCString() },
  });

describe('portal service worker caches (PR #2 review follow-up)', () => {
  it('names the asset cache after the build', async () => {
    const caches = memoryCaches();
    await loadWorker('abc123', caches).activate();
    expect([...caches.stores.keys()]).toContain('repsy-assets-abc123');
  });

  it('a new build drops the old asset cache, keeping only what stored pages reference', async () => {
    const caches = memoryCaches();
    const now = new Date();
    const pages = await caches.api.open('repsy-pages-v1');
    await pages.put(WORKOUT, page(['/_next/static/chunks/a.js'], now));
    await pages.put('/portal', page(['/_next/static/chunks/a.js'], now));
    const old = await caches.api.open('repsy-assets-build1');
    await old.put('/_next/static/chunks/a.js', new Response('a'));
    await old.put('/_next/static/chunks/unused.js', new Response('u'));

    await loadWorker('build2', caches).activate();

    expect([...caches.stores.keys()].sort()).toEqual(['repsy-assets-build2', 'repsy-pages-v1']);
    const current = caches.stores.get('repsy-assets-build2')!;
    expect([...current.keys()]).toEqual([`${ORIGIN}/_next/static/chunks/a.js`]);
    // The stored workout still has its page and its script.
    expect(caches.stores.get('repsy-pages-v1')!.has(`${ORIGIN}${WORKOUT}`)).toBe(true);
  });

  it('drops workout pages stored more than 14 days ago, and the assets only they needed', async () => {
    const caches = memoryCaches();
    const now = Date.now();
    const pages = await caches.api.open('repsy-pages-v1');
    await pages.put(WORKOUT, page(['/_next/static/chunks/a.js'], new Date(now - DAY_MS)));
    await pages.put(
      OLD_WORKOUT,
      page(['/_next/static/chunks/old.js'], new Date(now - 15 * DAY_MS)),
    );
    // The portal home is kept whatever its age.
    await pages.put('/portal', page([], new Date(now - 30 * DAY_MS)));
    const old = await caches.api.open('repsy-assets-build1');
    await old.put('/_next/static/chunks/a.js', new Response('a'));
    await old.put('/_next/static/chunks/old.js', new Response('o'));

    await loadWorker('build2', caches).activate();

    expect([...caches.stores.get('repsy-pages-v1')!.keys()].sort()).toEqual([
      `${ORIGIN}/portal`,
      `${ORIGIN}${WORKOUT}`,
    ]);
    expect([...caches.stores.get('repsy-assets-build2')!.keys()]).toEqual([
      `${ORIGIN}/_next/static/chunks/a.js`,
    ]);
  });

  it('the same build activating again keeps its asset cache', async () => {
    const caches = memoryCaches();
    const assets = await caches.api.open('repsy-assets-build2');
    await assets.put('/_next/static/chunks/b.js', new Response('b'));
    await loadWorker('build2', caches).activate();
    expect(caches.stores.get('repsy-assets-build2')!.size).toBe(1);
  });

  it('an unsafe build id is cleaned before it names a cache', async () => {
    const caches = memoryCaches();
    await loadWorker('a%2F..%20b', caches).activate();
    expect([...caches.stores.keys()]).toContain('repsy-assets-ab');
  });

  it('keeps the next workouts for offline use, fetching again only pages older than an hour (PRD D4)', async () => {
    const caches = memoryCaches();
    const fetched: string[] = [];
    const fakeFetch = (async (url: string) => {
      fetched.push(new URL(url, ORIGIN).pathname);
      return page([], new Date());
    }) as unknown as typeof fetch;
    const pages = await caches.api.open('repsy-pages-v1');
    await pages.put(OLD_WORKOUT, page([], new Date()));
    const worker = loadWorker('b', caches, fakeFetch);
    await worker.message({
      type: 'keep-upcoming',
      sessionIds: [WORKOUT.split('/').pop(), OLD_WORKOUT.split('/').pop(), 'not-a-session'],
    });
    expect(fetched.sort()).toEqual(['/portal', WORKOUT]);
    expect(caches.stores.get('repsy-pages-v1')!.has(`${ORIGIN}${WORKOUT}`)).toBe(true);
  });
});
