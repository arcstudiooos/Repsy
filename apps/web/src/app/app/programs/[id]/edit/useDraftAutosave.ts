'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Quiet time after the last edit before the draft is sent. */
export const DRAFT_DEBOUNCE_MS = 800;

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export const AUTOSAVE_LABEL: Record<AutosaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Draft saved',
  offline: 'Offline – draft kept on this device',
  error: "Couldn't save the draft",
};

/** The draft body besides `baseVersionNo`: raw builder state, loads in kg (see editorSchema `toDraftPayload`). */
export interface DraftPayload {
  title?: string;
  weeks: unknown[];
}

/** The device copy kept while the server can't be reached. */
export interface LocalDraft {
  baseVersionNo: number | null;
  values: DraftPayload;
  savedAt: string;
}

export const localDraftKey = (programId: string) => `repsy:program-draft:${programId}`;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked storage (privacy mode) must never break the editor
  }
}

/** The device copy, or null when absent, unreadable or of an unexpected shape. */
export function readLocalDraft(
  programId: string,
  storage: StorageLike | null = browserStorage(),
): LocalDraft | null {
  try {
    const raw = storage?.getItem(localDraftKey(programId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraft> | null;
    if (
      !parsed ||
      typeof parsed.savedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.savedAt)) ||
      !(parsed.baseVersionNo === null || typeof parsed.baseVersionNo === 'number') ||
      !parsed.values ||
      !Array.isArray(parsed.values.weeks)
    ) {
      return null;
    }
    return parsed as LocalDraft;
  } catch {
    return null;
  }
}

export function clearLocalDraft(
  programId: string,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.removeItem(localDraftKey(programId));
  } catch {
    // nothing to clean up when storage is unavailable
  }
}

export interface AutosaverDeps {
  fetch: typeof fetch;
  storage: () => StorageLike | null;
  isOnline: () => boolean;
  /** Where `online` and `pagehide` are heard (the window). */
  target: EventTarget | null;
}

const browserDeps = (): AutosaverDeps => ({
  fetch: (...args) => fetch(...args),
  storage: browserStorage,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  target: typeof window === 'undefined' ? null : window,
});

interface Snapshot {
  values: DraftPayload;
  baseVersionNo: number | null;
  key: string;
}

/**
 * The autosave engine behind `useDraftAutosave`, kept free of React so it can be unit tested. Saves are serialized
 * (one PUT in flight at a time) and always send the latest values. Offline or on a network error the latest values
 * go to localStorage and are sent again on `online`.
 */
export class DraftAutosaver {
  private latest: Snapshot | null = null;
  /** Key of the last snapshot the server acknowledged. */
  private savedKey: string | null = null;
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private offline = false;
  private inFlight = false;
  /** The form went back to the saved content: the server draft must go (sent when online). */
  private discardPending = false;
  private disposed = false;
  private readonly deps: AutosaverDeps;

  constructor(
    private readonly programId: string,
    private readonly onStatus: (status: AutosaveStatus) => void,
    deps: Partial<AutosaverDeps> = {},
  ) {
    this.deps = { ...browserDeps(), ...deps };
    this.deps.target?.addEventListener('online', this.onOnline);
    this.deps.target?.addEventListener('pagehide', this.onPageHide);
  }

  /** New editor values. `enabled` is false when there is nothing to keep (no unsaved changes). */
  update(values: DraftPayload, baseVersionNo: number | null, enabled: boolean): void {
    const key = JSON.stringify({ baseVersionNo, values });
    const changed = key !== this.latest?.key;
    const wasEnabled = this.enabled;
    this.latest = { values, baseVersionNo, key };
    this.enabled = enabled;
    if (!enabled) {
      if (this.timer) this.onStatus('idle');
      this.clearTimer();
      if (wasEnabled) {
        // Nothing unsaved any more (an undo back to the saved content, a commit, a discard). A draft or device copy
        // left holding the earlier edit would be restored on the next load, so both go. Idempotent after a commit,
        // which already deleted the draft.
        this.discardPending = true;
        clearLocalDraft(this.programId, this.deps.storage());
        void this.enqueue();
      }
      return;
    }
    this.discardPending = false;
    if (!changed && this.timer) return; // a re-render with the same values keeps the pending save
    if (key === this.savedKey && !this.inFlight) {
      // Back to what the server already holds (an edit undone inside the debounce window).
      const pending = this.timer !== null;
      this.clearTimer();
      if (pending) this.onStatus('saved');
      return;
    }
    this.clearTimer();
    this.onStatus('saving');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue();
    }, DRAFT_DEBOUNCE_MS);
  }

  /** Sends pending values now and waits for every save in flight. `force` re-sends values already saved. */
  flush(opts: { force?: boolean } = {}): Promise<void> {
    this.clearTimer();
    if (!this.enabled || !this.latest) return this.chain;
    if (opts.force) this.savedKey = null;
    return this.enqueue();
  }

  dispose(): void {
    this.deps.target?.removeEventListener('online', this.onOnline);
    this.deps.target?.removeEventListener('pagehide', this.onPageHide);
    const pending = this.timer !== null;
    this.clearTimer();
    // Leaving the editor inside the debounce window still sends the last edit.
    if (pending) void this.enqueue();
    this.disposed = true;
  }

  private readonly onOnline = () => {
    if (this.offline && (this.enabled || this.discardPending)) void this.enqueue();
  };

  /** A reload or tab close inside the debounce window: keep the unsent edit on the device. */
  private readonly onPageHide = () => {
    if (this.timer && this.latest) this.writeLocal(this.latest);
  };

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private enqueue(): Promise<void> {
    this.chain = this.chain.then(() => this.send());
    return this.chain;
  }

  private status(status: AutosaveStatus) {
    if (!this.disposed) this.onStatus(status);
  }

  private writeLocal(snap: Snapshot) {
    try {
      const copy: LocalDraft = {
        baseVersionNo: snap.baseVersionNo,
        values: snap.values,
        savedAt: new Date().toISOString(),
      };
      this.deps.storage()?.setItem(localDraftKey(this.programId), JSON.stringify(copy));
    } catch {
      // storage full or blocked: the status still says offline, the edit stays in the form
    }
  }

  private async discard(): Promise<void> {
    if (!this.deps.isOnline()) {
      this.offline = true;
      return;
    }
    let res: Response;
    try {
      res = await this.deps.fetch(`/api/v1/programs/${encodeURIComponent(this.programId)}/draft`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch {
      this.offline = true;
      return;
    }
    // Re-enabled meanwhile: the next PUT replaces the draft anyway.
    if (!this.enabled) this.discardPending = false;
    this.offline = false;
    this.savedKey = null;
    this.status(res.ok ? 'idle' : 'error');
  }

  private async send(): Promise<void> {
    if (!this.enabled) {
      if (this.discardPending) await this.discard();
      return;
    }
    const snap = this.latest;
    if (!snap) return;
    if (snap.key === this.savedKey) {
      if (!this.timer) this.status('saved');
      return;
    }
    if (!this.deps.isOnline()) {
      this.offline = true;
      this.writeLocal(snap);
      this.status('offline');
      return;
    }
    let res: Response;
    this.inFlight = true;
    try {
      res = await this.deps.fetch(`/api/v1/programs/${encodeURIComponent(this.programId)}/draft`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseVersionNo: snap.baseVersionNo, ...snap.values }),
      });
    } catch {
      this.offline = true;
      this.writeLocal(this.latest ?? snap);
      this.status('offline');
      return;
    } finally {
      this.inFlight = false;
    }
    if (!res.ok) {
      this.status('error');
      return;
    }
    this.savedKey = snap.key;
    this.offline = false;
    if (this.latest?.key === snap.key) {
      // The server holds the latest values: the device copy is no longer needed.
      clearLocalDraft(this.programId, this.deps.storage());
      if (!this.timer) this.status('saved');
    } else if (!this.timer && this.enabled) {
      // Changed while this save was in flight with no save scheduled (e.g. undone): send the latest too.
      void this.enqueue();
    }
  }
}

/**
 * Autosaves the builder's draft (S3-1): a PUT 800 ms after the last change, a device copy while offline, retried
 * when the browser comes back online. `enabled` is false while there is nothing unsaved to keep.
 */
export function useDraftAutosave(
  programId: string,
  values: DraftPayload,
  { baseVersionNo, enabled }: { baseVersionNo: number | null; enabled: boolean },
): { status: AutosaveStatus; flush(opts?: { force?: boolean }): Promise<void> } {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const saver = useRef<DraftAutosaver | null>(null);

  useEffect(() => {
    const s = new DraftAutosaver(programId, setStatus);
    saver.current = s;
    return () => {
      s.dispose();
      if (saver.current === s) saver.current = null;
    };
  }, [programId]);

  // Keyed by content, so a re-render with equal values never restarts the debounce. Declared after the effect
  // above, so on mount the saver exists when this first runs.
  const key = JSON.stringify(values);
  useEffect(() => {
    saver.current?.update(JSON.parse(key) as DraftPayload, baseVersionNo, enabled);
  }, [key, baseVersionNo, enabled]);

  const flush = useCallback(
    (opts?: { force?: boolean }) => saver.current?.flush(opts) ?? Promise.resolve(),
    [],
  );
  return { status, flush };
}
