import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindOwner, DB_NAME, getAll, put, unsyncedCount, wipeDevice } from './db';
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

/** Whether `p` settles within a few event-loop turns. */
const settles = (p: Promise<unknown>) =>
  Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 50))]);

beforeEach(() => freshDeviceStore());
afterEach(() => vi.unstubAllGlobals());

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
    expect(await settles(getAll<Mutation>('outbox'))).toBe(false);
    // No user bound: a flush (the sync loop's timer firing during sign-out) sends nothing and opens nothing.
    expect(await flush()).toEqual({ sent: 0, pending: 0, blocked: 0, rejected: 0 });
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(DB_NAME);
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
