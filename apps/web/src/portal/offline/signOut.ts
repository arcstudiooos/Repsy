/**
 * Sign-out on this device (PR #2 review C1). The portal's offline data (workouts, queued writes, the service worker's
 * page caches) belongs to the signed-in user and must not outlive their session on a shared device. Before signing
 * out, queued writes get one last chance to reach the server; whatever is still unsynced is counted so the sign-out
 * flow can warn ("Sign out anyway?") instead of destroying a workout silently. On confirm, `wipeDevice` deletes it.
 */
import { currentOwner, hasDeviceStore, unsyncedCount } from './db';
import { flush } from './outbox';

export { deletePageCaches, DeviceWipeError, wipeDevice } from './db';

/**
 * Tries to send what is queued (bounded by `timeoutMs`, so a hanging network can't stall sign-out), then returns how
 * many writes on this device the server still hasn't accepted (queued or refused). Rejects when the count can't be
 * read: the caller then asks before deleting, never assumes nothing is unsynced (PR #2 re-review N1).
 */
export async function unsyncedBeforeSignOut(timeoutMs = 5000): Promise<number> {
  if (!hasDeviceStore()) return 0;
  if (currentOwner()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      flush().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
  }
  return unsyncedCount();
}
