import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindOwner, DB_NAME, getAll, resetDbForTests } from './db';
import { OWNER, SESSION } from './test-helpers';

const LEGACY = 'kinetic-offline';

/** A store as an older build left it, under the pre-rename name, with one queued write. */
async function seedLegacy(owner: { userId: string; orgId: string }) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(LEGACY, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('workouts', { keyPath: 'sessionId' });
      db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      db.createObjectStore('rejected', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      db.createObjectStore('meta');
      db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['outbox', 'meta'], 'readwrite');
      tx.objectStore('outbox').put({ id: 'm1', sessionId: SESSION, kind: 'logs', body: {} });
      tx.objectStore('meta').put(owner, 'owner');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

describe('pre-rename offline store', () => {
  it('moves queued writes into the renamed store and deletes the old one', async () => {
    await seedLegacy(OWNER);
    await bindOwner(OWNER);
    expect((await getAll<{ id: string }>('outbox')).map((m) => m.id)).toEqual(['m1']);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain(DB_NAME);
    expect(names).not.toContain(LEGACY);
  });

  it('still drops the moved rows when they belong to another user', async () => {
    await seedLegacy({ userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', orgId: OWNER.orgId });
    await bindOwner(OWNER);
    expect(await getAll('outbox')).toEqual([]);
  });

  it('opens normally when there is no old store', async () => {
    await bindOwner(OWNER);
    expect(await getAll('outbox')).toEqual([]);
  });
});
