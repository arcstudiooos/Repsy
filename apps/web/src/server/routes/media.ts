import { z } from 'zod';
import {
  addProgressPhoto,
  deleteProgressPhoto,
  DomainError,
  listProgressPhotos,
  mediaForDownload,
  mediaPlayback,
  prepareUpload,
  recordMedia,
  storageKeyFor,
  uploadOwner,
} from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';
import { exportStorage } from './exports';

/** The largest body read at all (the per-type limits in core are lower or equal). */
const MAX_UPLOAD = 100 * 1024 * 1024;

/**
 * The request body, or null once it passes `max` bytes. Reading stops there, so a chunked body (no Content-Length)
 * or a false Content-Length cannot push more than `max` into memory.
 */
export async function readBodyCapped(request: Request, max: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * `POST /api/v1/media?purpose=...&clientId=...` (D-011 #5): the raw file as the body. The owner is checked before
 * anything is stored; images are stored without metadata. Returns the file id to attach.
 */
export const mediaUploadRoute: RouteDef<undefined, true> = {
  rateLimit: { capacity: 30, refillPerSecond: 30 / 3600 },
  handler: async ({ actor, request, tenant }) => {
    const url = new URL(request.url);
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_UPLOAD) {
      throw new DomainError('VALIDATION', 'Some fields are invalid.', {
        file: ['The file is too big.'],
      });
    }
    const body = await readBodyCapped(request, MAX_UPLOAD);
    if (body === null || body.length === 0) {
      throw new DomainError('VALIDATION', 'Some fields are invalid.', {
        file: [body === null ? 'The file is too big.' : 'Choose a file.'],
      });
    }
    const file = prepareUpload(url.searchParams.get('purpose'), body);
    const clientId = await tenant((tx) =>
      uploadOwner(tx, actor, file.purpose, url.searchParams.get('clientId')),
    );
    const key = storageKeyFor(actor.orgId, file.purpose);
    const storage = exportStorage.get();
    await storage.put(key, file.bytes, file.contentType);
    try {
      const row = await tenant((tx) =>
        recordMedia(tx, actor, {
          purpose: file.purpose,
          clientId,
          contentType: file.contentType,
          bytes: file.bytes.length,
          key,
        }),
      );
      return new ApiResult(row, { status: 201 });
    } catch (error) {
      await storage.deleteMany([key]).catch(() => undefined);
      throw error;
    }
  },
};

/** `GET /api/v1/media/:id`: the file, to its client and their coaches only; never cached by shared caches. */
export const mediaDownloadRoute: RouteDef<undefined, true> = {
  handler: async ({ actor, params, tenant }) => {
    const file = await tenant((tx) => mediaForDownload(tx, actor, params.id ?? ''));
    const bytes = await exportStorage.get().read(file.key);
    if (!bytes) throw new DomainError('NOT_FOUND', 'Not found.');
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': file.contentType,
        'content-length': String(bytes.length),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        'content-disposition': file.contentType === 'application/pdf' ? 'attachment' : 'inline',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  },
};

/** `GET /api/v1/media/:id/playback` (PRD L11): the adaptive HLS manifest when ready, else the MP4. */
export const mediaPlaybackRoute: RouteDef<undefined, true> = {
  handler: ({ actor, params, tenant }) => tenant((tx) => mediaPlayback(tx, actor, params.id ?? '')),
};

const photosQuery = z.object({ clientId: z.string().max(64).optional() });

/** `GET /api/v1/progress-photos?clientId=` (PRD E3): a client's own, or (coach) one client's. */
export const progressPhotosListRoute: RouteDef<typeof photosQuery, true> = {
  input: photosQuery,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) => listProgressPhotos(tx, actor, input.clientId)),
};

const photoSchema = z.object({
  clientId: z.string().max(64).optional(),
  mediaId: z.string().max(64),
  pose: z.string().max(10),
  takenOn: z.string().max(10).optional(),
});

export const progressPhotoPostRoute: RouteDef<typeof photoSchema, true> = {
  input: photoSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => addProgressPhoto(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const progressPhotoDeleteRoute: RouteDef<undefined, true> = {
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => deleteProgressPhoto(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};
