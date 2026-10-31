/**
 * The portal's device store (S3-3, D-004): one IndexedDB database with the started workouts (`workouts`), the
 * writes waiting for the server (`outbox`), the writes the server refused (`rejected`) and bookkeeping (`meta`: the
 * owner and the outbox sequence). No wrapper library: each helper below runs one transaction and resolves when it has
 * committed.
 *
 * Owner binding (PR #2 review C1): the store belongs to one user. The portal layout binds it (`bindOwner`) before
 * anything reads it: every data helper here waits for that, and a store left by another user is wiped, with the
 * service worker's page caches, before use. Sign-out (`wipeDevice`) deletes it all and unbinds, so nothing in the tab
 * reopens it afterwards.
 */
export const DB_NAME = 'kinetic-offline';
// v2 (PR #2 review): adds `meta`. v1 data has no owner, so the upgrade drops it (v1 never shipped).
const DB_VERSION = 2;

export type StoreName = 'workouts' | 'outbox' | 'rejected';
const DATA_STORES: StoreName[] = ['workouts', 'outbox', 'rejected'];
/** The service worker's caches of a user's pages (public/sw.js). Build assets hold no user data and stay. */
const PAGE_CACHE_PREFIX = 'kinetic-pages-';

export interface DeviceOwner {
  userId: string;
  /** The active organization: queued writes are sent only while their org is active (a client of two coaches). */
  orgId: string;
}

let opening: Promise<IDBDatabase> | null = null;

function openRaw(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 2) {
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      }
      db.createObjectStore('workouts', { keyPath: 'sessionId' });
      db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      db.createObjectStore('rejected', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      // Another tab upgrading or deleting the database (its sign-out): let it, and reopen on the next call.
      req.result.onversionchange = (event) => {
        req.result.close();
        opening = null;
        // Deleted: another tab signed out. This tab's owner is gone too, so nothing it types is queued under the
        // old user into the next user's store (PR #2 re-review M2); the next portal load binds again.
        if (event.newVersion === null) signedOut();
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

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

// --- owner -----------------------------------------------------------------------------------------------------

let owner: DeviceOwner | null = null;
let bound!: Promise<void>;
let markBound!: () => void;
let failBound!: (error: unknown) => void;
let bindFailed = false;
function unbind(): void {
  owner = null;
  bound = new Promise<void>((resolve, reject) => {
    markBound = resolve;
    failBound = reject;
  });
  bound.catch(() => undefined); // reported to each caller of openDb, not as an unhandled rejection
}
unbind();

/**
 * Signed out (here or in another tab): unbind, and fail every helper still waiting instead of leaving it pending for
 * good, so a flush in flight releases the outbox lock (PR #2 re-review M3). The next `bindOwner` starts afresh.
 */
function signedOut(): void {
  unbind();
  bindFailed = true;
  failBound(new Error('Signed out on this device.'));
}

/** The user (and active org) the store is bound to in this tab; null before binding and after sign-out. */
export const currentOwner = (): DeviceOwner | null => owner;

/** Opens the store once it is bound to the signed-in user (never before: it may hold someone else's data). */
export async function openDb(): Promise<IDBDatabase> {
  await bound;
  return openRaw();
}

/** Deletes the service worker's page caches (sign-out deletes them again once the session cookie is gone). */
export async function deletePageCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    if (name.startsWith(PAGE_CACHE_PREFIX)) await caches.delete(name);
  }
}

/**
 * Binds the store to the signed-in user (the portal layout, on every load). Data left by a different user, or by no
 * known user, is wiped first with the page caches: their workouts are never shown and their queued writes never sent
 * under this user's session. The same user in another org keeps theirs (each write waits for its org).
 */
export async function bindOwner(next: DeviceOwner): Promise<void> {
  // A different owner than this tab had (or a failed earlier bind): everything waits for this one.
  if (bindFailed || owner?.userId !== next.userId || owner.orgId !== next.orgId) {
    if (owner || bindFailed) unbind();
    bindFailed = false;
  }
  try {
    await claim(next);
  } catch (error) {
    // No usable store (private mode, quota): every helper fails as it would have without an owner check.
    bindFailed = true;
    failBound(error);
    throw error;
  }
  owner = { userId: next.userId, orgId: next.orgId };
  markBound();
}

async function claim(next: DeviceOwner): Promise<void> {
  const db = await openRaw();
  const tx = db.transaction(['meta', ...DATA_STORES], 'readwrite');
  const meta = tx.objectStore('meta');
  const stored = await result(meta.get('owner') as IDBRequest<DeviceOwner | undefined>);
  let foreign = stored !== undefined && stored.userId !== next.userId;
  if (stored === undefined) {
    for (const name of DATA_STORES) {
      if ((await result(tx.objectStore(name).count())) > 0) foreign = true;
    }
  }
  if (foreign) {
    for (const name of DATA_STORES) tx.objectStore(name).clear();
  }
  meta.put({ userId: next.userId, orgId: next.orgId }, 'owner');
  await committed(tx);
  if (foreign) await deletePageCaches();
}

/** How long sign-out waits for IndexedDB (an open blocked by an old tab never settles). */
const WIPE_TIMEOUT_MS = 3000;

/** Thrown when sign-out could not remove this device's offline data: the caller must not sign out silently. */
export class DeviceWipeError extends Error {
  constructor() {
    super("Couldn't clear this device.");
    this.name = 'DeviceWipeError';
  }
}

const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

/** Deletes the database without an open connection: true once it is gone, false on an error or a block. */
const deleteDatabase = (): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
  });

/**
 * Sign-out: deletes this device's offline data (the database and the service worker's page caches) and unbinds this
 * tab. Works whether or not a user was bound (the coach shell signs out through the same button). Fails closed (PR #2
 * re-review N1): the page caches are always deleted, the database is cleared and deleted independently (each bounded
 * in time), and `DeviceWipeError` is thrown unless both the caches and the data are gone.
 */
export async function wipeDevice(): Promise<void> {
  signedOut();
  let dataGone = true;
  if (typeof indexedDB !== 'undefined') {
    let cleared = false;
    try {
      // Clear first: if another tab keeps the database open and blocks the delete, the data is gone anyway.
      await within(
        (async () => {
          const db = await openRaw();
          const names = ['meta', ...DATA_STORES];
          const tx = db.transaction(names, 'readwrite');
          for (const name of names) tx.objectStore(name).clear();
          await committed(tx);
          db.close();
        })(),
        WIPE_TIMEOUT_MS,
      );
      cleared = true;
    } catch {
      // A dead connection (iOS "Connection to Indexed Database server lost") or a blocked open: delete below.
    } finally {
      opening = null;
    }
    const deleted = await within(deleteDatabase(), WIPE_TIMEOUT_MS).catch(() => false);
    dataGone = cleared || deleted;
  }
  const cachesGone = await deletePageCaches().then(
    () => true,
    () => false,
  );
  if (!dataGone || !cachesGone) throw new DeviceWipeError();
}

/** Writes on this device the server hasn't acknowledged: queued, or refused and kept (any user, any org). */
export async function unsyncedCount(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await within(openRaw(), WIPE_TIMEOUT_MS);
  const tx = db.transaction(['outbox', 'rejected'], 'readonly');
  const [queued, refused] = await Promise.all([
    result(tx.objectStore('outbox').count()),
    result(tx.objectStore('rejected').count()),
  ]);
  return queued + refused;
}

/** Tests only: forget the open connection and the owner (each test installs a fresh IDBFactory). */
export function resetDbForTests(): void {
  opening = null;
  unbind();
}

/** True where the device store can work at all (not during server rendering, or in very old browsers). */
export const hasDeviceStore = (): boolean => typeof indexedDB !== 'undefined';

async function transact<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const value = result(fn(tx.objectStore(store)));
  await committed(tx);
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

/**
 * Stores an outbox item at the next queue position (`seq`), in one transaction so two tabs never share a number. An
 * item stored again under the same id keeps its position. The queue never orders by the wall clock (PR #2 review I2).
 */
export async function putInQueue<T extends { id: string }>(value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['meta', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  const existing = await result(outbox.get(value.id) as IDBRequest<{ seq?: number } | undefined>);
  let seq = existing?.seq;
  if (seq === undefined) {
    const meta = tx.objectStore('meta');
    seq = ((await result(meta.get('seq') as IDBRequest<number | undefined>)) ?? 0) + 1;
    meta.put(seq, 'seq');
  }
  outbox.put({ ...value, seq });
  await committed(tx);
}
