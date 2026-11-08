import { withSystem, type PrismaClient, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { mediaForDownload } from './media';

/**
 * PRD L11: adaptive video. Coach demo videos (purpose `exercise_demo`) are sent to Cloudflare Stream,
 * which transcodes them into an HLS ladder (several bitrates; the player switches with the network).
 * Until the stream is ready, or when Stream is not configured, the original MP4 keeps playing.
 *
 * Playback manifests are not signed: demo videos are coach teaching content, not client data, and
 * each uid is random. Client videos (form checks) are never sent to Stream.
 */
export const STREAM_PURPOSES = ['exercise_demo'] as const;

export interface StreamConfig {
  accountId: string;
  apiToken: string;
}

type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

export function streamConfig(env: Env = process.env): StreamConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_STREAM_TOKEN;
  return accountId && apiToken ? { accountId, apiToken } : null;
}

const api = (config: StreamConfig, path = '') =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/stream${path}`;

interface StreamVideo {
  uid: string;
  readyToStream?: boolean;
  status?: { state?: string };
  playback?: { hls?: string };
}

async function streamCall(
  config: StreamConfig,
  path: string,
  init: RequestInit,
  fetchImpl: Fetch,
): Promise<StreamVideo | null> {
  const res = await fetchImpl(api(config, path), {
    ...init,
    headers: { authorization: `Bearer ${config.apiToken}`, ...(init.headers ?? {}) },
  });
  if (res.status === 404) return null;
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: StreamVideo };
  if (!res.ok || json.success === false) {
    throw new Error(`Cloudflare Stream returned ${res.status}.`);
  }
  return json.result ?? null;
}

/** Uploads an MP4 (basic upload, up to 200 MB) and returns the Stream uid. */
export async function uploadToStream(
  config: StreamConfig,
  video: { bytes: Buffer; name: string },
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(video.bytes)], { type: 'video/mp4' }), video.name);
  const result = await streamCall(config, '', { method: 'POST', body: form }, fetchImpl);
  if (!result?.uid) throw new Error('Cloudflare Stream returned no video id.');
  return result.uid;
}

export async function streamStatus(
  config: StreamConfig,
  uid: string,
  fetchImpl: Fetch = fetch,
): Promise<{ state: 'processing' | 'ready' | 'error'; hls: string | null }> {
  const video = await streamCall(
    config,
    `/${encodeURIComponent(uid)}`,
    { method: 'GET' },
    fetchImpl,
  );
  if (!video || video.status?.state === 'error') return { state: 'error', hls: null };
  if (video.readyToStream && video.playback?.hls)
    return { state: 'ready', hls: video.playback.hls };
  return { state: 'processing', hls: null };
}

export async function deleteFromStream(
  config: StreamConfig,
  uid: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  await streamCall(config, `/${encodeURIComponent(uid)}`, { method: 'DELETE' }, fetchImpl);
}

/** How the player should load a file: the HLS manifest when transcoding is done, else the MP4. */
export async function mediaPlayback(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
): Promise<{ hls: string | null; mp4: string; processing: boolean }> {
  await mediaForDownload(tx, actor, id);
  const row = await tx.mediaFile.findFirstOrThrow({
    where: { id: id as string },
    select: { streamStatus: true, streamHlsUrl: true },
  });
  return {
    hls: row.streamStatus === 'ready' ? row.streamHlsUrl : null,
    mp4: `/api/v1/media/${id as string}`,
    processing: row.streamStatus === 'processing',
  };
}

/**
 * Worker sweep (system scope): sends new demo videos to Stream, records finished transcodes, and
 * deletes the Stream copy of erased files.
 */
export async function processVideoStreams(
  prisma: PrismaClient,
  storage: { read(key: string): Promise<Buffer | null> },
  config: StreamConfig,
  deps: { fetchImpl?: Fetch; limit?: number } = {},
): Promise<{ sent: number; ready: number; removed: number; failed: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const stats = { sent: 0, ready: 0, removed: 0, failed: 0 };
  const take = deps.limit ?? 10;
  const update = (id: string, data: Record<string, unknown>) =>
    withSystem((tx) => tx.mediaFile.update({ where: { id }, data }), prisma);

  const [fresh, processing, erased] = await withSystem(
    (tx) =>
      Promise.all([
        tx.mediaFile.findMany({
          where: {
            purpose: { in: [...STREAM_PURPOSES] },
            contentType: 'video/mp4',
            erasedAt: null,
            streamStatus: null,
          },
          orderBy: { createdAt: 'asc' },
          take,
          select: { id: true, storageKey: true },
        }),
        tx.mediaFile.findMany({
          where: { streamStatus: 'processing', erasedAt: null, streamUid: { not: null } },
          take: 50,
          select: { id: true, streamUid: true },
        }),
        tx.mediaFile.findMany({
          where: { erasedAt: { not: null }, streamUid: { not: null } },
          take: 50,
          select: { id: true, streamUid: true },
        }),
      ]),
    prisma,
  );

  for (const file of fresh) {
    try {
      const bytes = await storage.read(file.storageKey);
      if (!bytes) {
        await update(file.id, { streamStatus: 'error' });
        stats.failed += 1;
        continue;
      }
      const uid = await uploadToStream(config, { bytes, name: `${file.id}.mp4` }, fetchImpl);
      await update(file.id, { streamUid: uid, streamStatus: 'processing' });
      stats.sent += 1;
    } catch {
      stats.failed += 1;
    }
  }
  for (const file of processing) {
    try {
      const status = await streamStatus(config, file.streamUid as string, fetchImpl);
      if (status.state === 'processing') continue;
      await update(file.id, { streamStatus: status.state, streamHlsUrl: status.hls });
      if (status.state === 'ready') stats.ready += 1;
      else stats.failed += 1;
    } catch {
      stats.failed += 1;
    }
  }
  for (const file of erased) {
    try {
      await deleteFromStream(config, file.streamUid as string, fetchImpl);
      await update(file.id, { streamUid: null, streamHlsUrl: null });
      stats.removed += 1;
    } catch {
      stats.failed += 1;
    }
  }
  return stats;
}
