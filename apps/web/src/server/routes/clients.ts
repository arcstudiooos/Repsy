import { z } from 'zod';
import { appendAudit } from '@kinetic/db';
import {
  applyPause,
  createClient,
  getClient,
  getClientHistory,
  importClients,
  IMPORT_MAX_ROWS,
  listClients,
  resumeNow,
  updateClient,
  updatePause,
  type ClientView,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
const listSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['invited', 'active', 'paused', 'archived']).optional(),
  cursor: z.string().min(1).max(500).optional(),
});

export const clientsListRoute: RouteDef<typeof listSchema, true> = {
  can: 'client:read',
  input: listSchema,
  handler: async ({ actor, input, tenant }) => {
    const { items, nextCursor } = await tenant((tx) => listClients(tx, actor, input));
    return new ApiResult(items, { meta: { nextCursor } });
  },
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254),
  goals: z.string().max(2000).optional(),
});

export const clientsPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'client:create',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant }) => {
    const client = await tenant(async (tx) => {
      const created = await createClient(tx, actor, input);
      await appendAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        objectType: 'client',
        objectId: created.id,
        action: 'client.created',
        requestId,
      });
      return created;
    });
    return new ApiResult(client satisfies ClientView, { status: 201 });
  },
};

const importCell = z.string().max(4000).nullable().optional();
const importSchema = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().max(4000),
        email: z.string().max(4000),
        goals: importCell,
        timezone: importCell,
        units: importCell,
      }),
    )
    .max(IMPORT_MAX_ROWS),
  dryRun: z.boolean().optional(),
});

/**
 * `POST /api/v1/clients/import` (PRD B17): bulk-create clients from a roster. `dryRun: true` only validates.
 * Row problems come back per row (200), never as a request error, so one bad row does not block the rest.
 */
export const clientsImportRoute: RouteDef<typeof importSchema, true> = {
  can: 'client:create',
  input: importSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant(async (tx) => {
      const result = await importClients(tx, actor, input);
      for (const r of result.rows) {
        if (!r.clientId) continue;
        await appendAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          objectType: 'client',
          objectId: r.clientId,
          action: 'client.created',
          metadata: { source: 'import' },
          requestId,
        });
      }
      return result;
    }),
};

export const clientGetRoute: RouteDef<undefined, true> = {
  can: 'client:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => getClient(tx, actor, params.id ?? '')),
};

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  goals: z.string().max(2000).nullable().optional(),
  // Transitions are enforced by updateClient (nextClientStatus); `invited` is only reachable from archived.
  status: z.enum(['invited', 'active', 'paused', 'archived']).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const clientPatchRoute: RouteDef<typeof patchSchema, true> = {
  can: 'client:update',
  input: patchSchema,
  handler: ({ actor, input, params, requestId, tenant }) => {
    const id = params.id ?? '';
    return tenant(async (tx) => {
      // Nothing to change (unknown keys are stripped): no write, no audit; still a 404 for an unknown id.
      if (Object.values(input).every((v) => v === undefined)) return getClient(tx, actor, id);
      const updated = await updateClient(tx, actor, id, input);
      await appendAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        objectType: 'client',
        // The stored id, not the raw URL segment (which may differ in case).
        objectId: updated.id,
        action: 'client.updated',
        requestId,
      });
      return updated;
    });
  },
};

// Comma-separated exercise ids; count and format are checked by getClientHistory (fieldErrors.exerciseIds).
const historySchema = z.object({ exerciseIds: z.string().max(2000).optional() });

/** `:id` is the client. Per exerciseId, the sets of the client's last completed session that logged it. */
export const clientHistoryRoute: RouteDef<typeof historySchema, true> = {
  can: 'client:read',
  input: historySchema,
  handler: ({ actor, input, params, tenant }) => {
    const ids = (input.exerciseIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
    return tenant((tx) => getClientHistory(tx, actor, params.id ?? '', ids));
  },
};

// Dates are checked by the core (fieldErrors on the field), so a bad value reads like every other 422.
const pauseSchema = z.object({
  startLocalDate: z.string().max(20),
  resumeLocalDate: z.string().max(20),
});

/** `:id` is the client. Pauses the program (D-003); replaying the same dates is a no-op. Returns the client. */
export const clientPausePostRoute: RouteDef<typeof pauseSchema, true> = {
  can: 'client:update',
  input: pauseSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    const { client, shifted } = await tenant(async (tx) => {
      const res = await applyPause(
        tx,
        actor,
        { clientId: params.id ?? '', ...input },
        { requestId },
      );
      return { client: await getClient(tx, actor, params.id ?? ''), shifted: res.shifted };
    });
    return new ApiResult(client, { meta: { shifted } });
  },
};

const pausePatchSchema = z.object({ resumeLocalDate: z.string().max(20) });

/** Changes the expected resume date of the open pause. */
export const clientPausePatchRoute: RouteDef<typeof pausePatchSchema, true> = {
  can: 'client:update',
  input: pausePatchSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    const { client, shifted } = await tenant(async (tx) => {
      const res = await updatePause(
        tx,
        actor,
        { clientId: params.id ?? '', resumeLocalDate: input.resumeLocalDate },
        { requestId },
      );
      return { client: await getClient(tx, actor, params.id ?? ''), shifted: res.shifted };
    });
    return new ApiResult(client, { meta: { shifted } });
  },
};

/** Ends the open pause today. */
export const clientResumeRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    const { client, shifted } = await tenant(async (tx) => {
      const res = await resumeNow(tx, actor, { clientId: params.id ?? '' }, { requestId });
      return { client: await getClient(tx, actor, params.id ?? ''), shifted: res.shifted };
    });
    return new ApiResult(client, { meta: { shifted } });
  },
};
