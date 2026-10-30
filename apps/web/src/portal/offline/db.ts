/**
 * The portal's device store (S3-3, D-004): one IndexedDB database with the started workouts (`workouts`), the
 * writes waiting for the server (`outbox`) and the writes the server refused (`rejected`). No wrapper library: each
 * helper below runs one transaction and resolves when it has committed.
 */
export const DB_NAME = 'kinetic-offline';
const DB_VERSION = 1;

export type StoreName = 'workouts' | 'outbox' | 'rejected';

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('workouts', { keyPath: 'sessionId' });
      db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      db.createObjectStore('rejected', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
    };
    req.onsuccess = () => {
      // Another tab upgrading later: let it, and reopen on the next call.
      req.result.onversionchange = () => {
        req.result.close();
        opening = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

/** Tests only: forget the open connection (each test installs a fresh IDBFactory). */
export function resetDbForTests(): void {
  opening = null;
}

/** True where the device store can work at all (not during server rendering, or in very old browsers). */
export const hasDeviceStore = (): boolean => typeof indexedDB !== 'undefined';

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function transact<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const value = result(fn(tx.objectStore(store)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return value;
}

export const get = <T>(store: StoreName, key: string) =>
  transact(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);

export const getAll = <T>(store: StoreName) =>
  transact(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);

export const getBySession = <T>(store: 'outbox' | 'rejected', sessionId: string) =>
  transact(store, 'readonly', (s) => s.index('sessionId').getAll(sessionId) as IDBRequest<T[]>);

export const put = <T>(store: StoreName, value: T) =>
  transact(store, 'readwrite', (s) => s.put(value)).then(() => undefined);

export const del = (store: StoreName, key: string) =>
  transact(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);

export const countOutbox = (sessionId: string) =>
  transact('outbox', 'readonly', (s) => s.index('sessionId').count(sessionId));
