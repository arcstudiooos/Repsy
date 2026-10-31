import { IDBDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindOwner,
  currentOwner,
  DB_NAME,
  DeviceWipeError,
  getAll,
  put,
  unsyncedCount,
  wipeDevice,
} from './db';
import { enqueue, flush, type Mutation } from './outbox';
import { unsyncedBeforeSignOut } from './signOut';
import {
  ackAll,
  detail,
  freshDeviceStore,
  item,
  OWNER,
  SESSION,
  stubCaches,
  stubServer,
} from './test-helpers';
import { cacheWorkout, localView } from './workoutCache';

const OTHER_USER = { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', orgId: OWNER.orgId };
const OTHER_ORG = { userId: OWNER.userId, orgId: 'pppppppp-pppp-4ppp-8ppp-pppppppppppp' };
const PAGES = 'kinetic-pages-v1';
const ASSETS = 'kinetic-assets-v1';

const logs = (id: string) =>
  enqueue({
    id,
    sessionId: SESSION,
    kind: 'logs',
    body: { items: [item(0, 8, new Date().toISOString())] },
  });

beforeEach(() => freshDeviceStore());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The open connection breaks (iOS "Connection to Indexed Database server lost"): every transaction throws. */
const breakConnection = () =>
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
    throw new DOMException('Connection to Indexed Database server lost', 'UnknownError');
  });

describe('device store owner (PR #2 review C1)', () => {
  it("a different user's sign-in wipes the previous user's workouts, queue and pages before use", async () => {
    const caches = stubCaches([PAGES, ASSETS]);
    stubServer(() => 'offline');
    await cacheWorkout(detail());
    await logs('a-1');
    await flush();

    await bindOwner(OTHER_USER);
    expect(await localView(SESSION)).toBeNull();
    expect(await getAll('outbox')).toHaveLength(0);
    expect([...caches]).toEqual([ASSETS]);
  });

  it('the same user signing in again keeps their unsynced writes', async () => {
    stubServer(() => 'offline');
    await logs('a-1');
    await bindOwner(OWNER);
    expect(await getAll('outbox')).toHaveLength(1);
  });

  it("never sends another user's queued writes, and holds another org's until it is active", async () => {
    const server = stubServer((_p, body) => ackAll(body));
    const foreign = {
      id: 'x',
      sessionId: SESSION,
      kind: 'logs',
      body: { items: [item(1, 5, new Date().toISOString())] },
      seq: 99,
      attempts: 0,
      userId: OTHER_USER.userId,
      orgId: OWNER.orgId,
    };
    await put('outbox', foreign);
    await flush();
    expect(server.calls).toHaveLength(0);

    await bindOwner(OTHER_ORG);
    await logs('org-2');
    await bindOwner(OWNER);
    await flush();
    expect(server.calls).toHaveLength(0); // org-2's write waits for org 2
    await bindOwner(OTHER_ORG);
    await flush();
    expect(server.calls).toHaveLength(1);
  });

  it('wipeDevice deletes the database and page caches, and nothing reopens it until a user binds', async () => {
    const caches = stubCaches([PAGES, ASSETS]);
    stubServer(() => 'offline');
    await cacheWorkout(detail());
    await logs('a-1');
    await wipeDevice();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(DB_NAME);
    expect([...caches]).toEqual([ASSETS]);
    // A helper still waiting (a flush in flight) fails instead of hanging on the outbox lock (re-review M3).
    await expect(getAll<Mutation>('outbox')).rejects.toThrow('Signed out');
    // No user bound: a flush (the sync loop's timer firing during sign-out) sends nothing and opens nothing.
    expect(await flush()).toEqual({ sent: 0, pending: 0, blocked: 0, rejected: 0 });
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(DB_NAME);
  });
});

describe('sign-out fails closed (PR #2 re-review N1)', () => {
  it('a dead database connection still deletes the database and the page caches', async () => {
    const caches = stubCaches([PAGES, ASSETS]);
    stubServer(() => 'offline');
    await cacheWorkout(detail());
    breakConnection();
    await wipeDevice();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(DB_NAME);
    expect([...caches]).toEqual([ASSETS]);
  });

  it('throws when the page caches could not be deleted, so the button does not sign out silently', async () => {
    vi.stubGlobal('caches', {
      keys: async () => {
        throw new Error('storage error');
      },
      delete: async () => false,
    });
    await expect(wipeDevice()).rejects.toBeInstanceOf(DeviceWipeError);
  });

  it('throws when neither clearing nor deleting the database worked', async () => {
    stubCaches([PAGES]);
    breakConnection();
    vi.spyOn(globalThis.indexedDB, 'deleteDatabase').mockImplementation(() => {
      const req = {} as IDBOpenDBRequest;
      setTimeout(() => req.onerror?.(new Event('error')), 0);
      return req;
    });
    await expect(wipeDevice()).rejects.toBeInstanceOf(DeviceWipeError);
  });

  it("another tab's sign-out (the database deleted) unbinds this tab (re-review M2)", async () => {
    stubServer(() => 'offline');
    await logs('a-1');
    expect(currentOwner()).toEqual(OWNER);
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
    });
    expect(currentOwner()).toBeNull();
    // Nothing is queued under the old user until a user binds again.
    await expect(logs('a-2')).rejects.toThrow();
    await bindOwner(OTHER_USER);
    expect(await getAll('outbox')).toHaveLength(0);
  });

  it('a count that cannot be read rejects instead of reporting 0 unsynced', async () => {
    await freshDeviceStore(null);
    vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('lost', 'UnknownError');
    });
    await expect(unsyncedBeforeSignOut()).rejects.toThrow('lost');
  });
});

describe('sign-out (PR #2 review C1)', () => {
  it('flushes first: nothing unsynced once the server took it', async () => {
    stubServer((_p, body) => ackAll(body));
    await logs('a-1');
    expect(await unsyncedBeforeSignOut()).toBe(0);
  });

  it('counts what is still queued (offline) or refused', async () => {
    stubServer(() => 'offline');
    await logs('a-1');
    expect(await unsyncedBeforeSignOut()).toBe(1);
    await put('rejected', {
      id: 'r',
      sessionId: SESSION,
      kind: 'logs',
      body: {},
      message: 'no',
      rejectedAt: 0,
    });
    expect(await unsyncedCount()).toBe(2);
  });

  it('works where no user is bound (the coach shell): nothing to flush, only a count', async () => {
    await freshDeviceStore(null);
    expect(await unsyncedBeforeSignOut()).toBe(0);
  });

  it("gives up waiting on a hanging network and still reports what's unsynced", async () => {
    stubServer(() => new Promise(() => undefined));
    await logs('a-1');
    expect(await unsyncedBeforeSignOut(50)).toBe(1);
  });
});
