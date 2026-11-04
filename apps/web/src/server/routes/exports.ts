import { join } from 'node:path';
import { z } from 'zod';
import {
  contentTypeOf,
  exportFileFor,
  listMyExports,
  requestExport,
  DomainError,
} from '@kinetic/core';
import { createStorage, type StoragePort } from '@kinetic/storage';
import { ApiResult, type RouteDef } from '../api';
import { signExportLink, verifyExportLink } from '../exportLinks';

// The web app runs from apps/web (like the dev email sink): the repo root is two levels up.
const repoRoot = join(process.cwd(), '..', '..');
let shared: StoragePort | undefined;
/** Storage for downloads; tests inject their own. */
export const exportStorage = {
  get: (): StoragePort => (shared ??= createStorage(process.env, repoRoot)),
  set: (s: StoragePort | undefined) => {
    shared = s;
  },
};

const requestSchema = z.object({
  scope: z.enum(['org', 'client_self']),
  idempotencyKey: z.string().max(64),
});

/** `POST /api/v1/exports`: an owner's organization export or a client's own (idempotent per key). */
export const exportsPostRoute: RouteDef<typeof requestSchema, true> = {
  input: requestSchema,
  // Each request queues a full build (PR #2 review C M-11): 5 per hour per user.
  rateLimit: { capacity: 5, refillPerSecond: 5 / 3600 },
  handler: async ({ actor, input, requestId, tenant, track }) => {
    const view = await tenant((tx) => requestExport(tx, actor, input, { requestId }));
    track('export_requested', { scope: input.scope });
    return new ApiResult(view, { status: 202 });
  },
};

/** `GET /api/v1/exports`: the acting user's exports. */
export const exportsListRoute: RouteDef<undefined, true> = {
  handler: ({ actor, tenant }) => tenant((tx) => listMyExports(tx, actor)),
};

/** `POST /api/v1/exports/:id/links`: one link per file, valid 15 minutes, for the requester only. */
export const exportLinksRoute: RouteDef<undefined, true> = {
  handler: async ({ actor, params, tenant, user }) => {
    const id = params.id ?? '';
    const view = await tenant(async (tx) => {
      const [mine] = (await listMyExports(tx, actor)).filter((e) => e.id === id);
      if (!mine) {
        // Someone else's job (or none): the same check as a download.
        await exportFileFor(tx, actor, id, '');
      }
      return mine;
    });
    if (!view || view.files.length === 0) {
      throw new DomainError('FORBIDDEN', 'This export is no longer available.');
    }
    const now = Date.now();
    const links = view.files.map((f) => {
      const { token, expiresAt } = signExportLink(
        { jobId: id, file: f.name, userId: user.id },
        now,
      );
      return {
        name: f.name,
        url: `/api/v1/exports/${id}/files/${encodeURIComponent(f.name)}?token=${encodeURIComponent(token)}`,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    });
    return links;
  },
};

const fileSchema = z.object({ token: z.string().min(1).max(2000) });

/**
 * `GET /api/v1/exports/:id/files/:name?token=…`: streams one CSV. The token must be valid and unexpired and the
 * signed-in user must be both the token's user and the export's requester (re-checked on every download).
 */
export const exportFileRoute: RouteDef<typeof fileSchema, true> = {
  input: fileSchema,
  handler: async ({ actor, input, params, tenant, user }) => {
    const id = params.id ?? '';
    const name = params.name ?? '';
    const check = verifyExportLink(
      input.token,
      { jobId: id, file: name, userId: user.id },
      Date.now(),
    );
    if (!check.ok) {
      throw new DomainError(
        'FORBIDDEN',
        check.reason === 'expired'
          ? 'This download link has expired. Open your exports to get a new one.'
          : 'This download link is not valid for you.',
      );
    }
    const file = await tenant((tx) => exportFileFor(tx, actor, id, name));
    const body = await exportStorage.get().read(file.key);
    if (!body) throw new DomainError('NOT_FOUND', 'Not found.');
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'content-type': contentTypeOf(file.name),
        'content-disposition': `attachment; filename="${file.name}"`,
        'cache-control': 'no-store',
      },
    });
  },
};
