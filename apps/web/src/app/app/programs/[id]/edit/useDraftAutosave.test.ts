import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_DEBOUNCE_MS,
  DraftAutosaver,
  localDraftKey,
  readLocalDraft,
  type AutosaveStatus,
} from './useDraftAutosave';

/** A Map-backed Storage stand-in (the unit tests run in node, without a DOM). */
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const ok = () =>
  Promise.resolve(
    new Response(JSON.stringify({ data: { updatedAt: '2026-10-30T10:00:00.000Z' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

const values = (title: string) => ({ title, weeks: [{ days: [{ title: 'Day 1' }] }] });

let fetchMock: ReturnType<typeof vi.fn>;
let storage: MemoryStorage;
let target: EventTarget;
let online: boolean;
let statuses: AutosaveStatus[];

function create() {
  return new DraftAutosaver('p1', (s) => statuses.push(s), {
    fetch: fetchMock as unknown as typeof fetch,
    storage: () => storage,
    isOnline: () => online,
    target,
  });
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as unknown;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T10:00:00.000Z'));
  fetchMock = vi.fn(ok);
  storage = new MemoryStorage();
  target = new EventTarget();
  online = true;
  statuses = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useDraftAutosave (DraftAutosaver)', () => {
  it('debounces to one PUT per 800 ms burst', async () => {
    const saver = create();
    saver.update(values('a'), 1, true);
    await vi.advanceTimersByTimeAsync(300);
    saver.update(values('ab'), 1, true);
    await vi.advanceTimersByTimeAsync(300);
    saver.update(values('abc'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('saving');

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/programs/p1/draft');
    expect(init.method).toBe('PUT');
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      baseVersionNo: 1,
      ...values('abc'),
    });
    expect(statuses.at(-1)).toBe('saved');

    // The same values again (a re-render) send nothing; a second burst sends once more.
    saver.update(values('abc'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    saver.update(values('abcd'), 1, true);
    saver.update(values('abcde'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    saver.dispose();
  });

  it('never enabled (nothing to save) sends nothing', async () => {
    const saver = create();
    saver.update(values('a'), 1, false);
    saver.update(values('b'), 1, false);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    saver.dispose();
  });

  it('enabled → false after a saved PUT discards the server draft and the device copy', async () => {
    const saver = create();
    saver.update(values('edited'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    storage.setItem(localDraftKey('p1'), JSON.stringify({ stale: true }));

    // The coach undoes the edit: the form is back at the committed content.
    saver.update(values('committed'), 1, false);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/programs/p1/draft');
    expect(init.method).toBe('DELETE');
    expect(storage.getItem(localDraftKey('p1'))).toBeNull();
    expect(statuses.at(-1)).toBe('idle');

    // Editing to the same value again saves it again (the server no longer has it).
    saver.update(values('edited'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[1].method).toBe('PUT');
    saver.dispose();
  });

  it('an edit undone inside the debounce window sends no PUT, only the discard', async () => {
    const saver = create();
    saver.update(values('a'), 1, true);
    saver.update(values('committed'), 1, false);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
    saver.dispose();
  });

  it('a discard while offline clears the device copy and runs when back online', async () => {
    online = false;
    const saver = create();
    saver.update(values('edited offline'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(storage.getItem(localDraftKey('p1'))).not.toBeNull();
    saver.update(values('committed'), 1, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.getItem(localDraftKey('p1'))).toBeNull();

    online = true;
    target.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
    saver.dispose();
  });

  it('network error → offline + localStorage copy', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const saver = create();
    saver.update(values('lost wifi'), 2, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('offline');
    expect(JSON.parse(storage.getItem(localDraftKey('p1')) as string)).toEqual({
      baseVersionNo: 2,
      values: values('lost wifi'),
      savedAt: '2026-10-30T10:00:00.800Z',
    });
    expect(readLocalDraft('p1', storage)).toMatchObject({ baseVersionNo: 2 });
    saver.dispose();
  });

  it('navigator.onLine === false → offline without a request', async () => {
    online = false;
    const saver = create();
    saver.update(values('plane'), null, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('offline');
    expect(readLocalDraft('p1', storage)?.values).toEqual(values('plane'));
    saver.dispose();
  });

  it('online event retries', async () => {
    online = false;
    const saver = create();
    saver.update(values('first'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    saver.update(values('latest'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(statuses.at(-1)).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();

    online = true;
    target.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      baseVersionNo: 1,
      ...values('latest'),
    });
    expect(statuses.at(-1)).toBe('saved');
    // The server has the latest values now: the device copy is no longer needed.
    expect(storage.getItem(localDraftKey('p1'))).toBeNull();
    saver.dispose();
  });

  it('an HTTP error → error status (no device copy)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'X' } }), { status: 500 })),
    );
    const saver = create();
    saver.update(values('a'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(statuses.at(-1)).toBe('error');
    expect(storage.getItem(localDraftKey('p1'))).toBeNull();
    saver.dispose();
  });

  it('reverting to the saved values settles the status; an edit reverted mid-flight is sent again', async () => {
    const saver = create();
    saver.update(values('a'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Typed and undone inside the debounce window: nothing to send, status back to saved.
    saver.update(values('ab'), 1, true);
    saver.update(values('a'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('saved');

    // Undone while 'ab' is in flight: the server must end up with 'a' again.
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = () => void ok().then(resolve))),
    );
    saver.update(values('ab'), 1, true);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    saver.update(values('a'), 1, true);
    release();
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchMock.mock.calls[2] as unknown[])).toEqual({
      baseVersionNo: 1,
      ...values('a'),
    });
    expect(statuses.at(-1)).toBe('saved');
    saver.dispose();
  });

  it('flush sends pending values now; flush({ force }) re-sends saved values', async () => {
    const saver = create();
    saver.update(values('a'), 1, true);
    await saver.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await saver.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await saver.flush({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    saver.dispose();
  });
});
