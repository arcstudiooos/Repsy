import { z } from 'zod';
import {
  commitProgramVersion,
  createProgram,
  duplicateTemplate,
  discardDraft,
  DomainError,
  getDraft,
  getProgram,
  listProgramVersions,
  listPrograms,
  renameProgram,
  saveDraft,
  setTemplateArchived,
  type WeekInput,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
const listSchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  q: z.string().max(200).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const programsListRoute: RouteDef<typeof listSchema, true> = {
  can: 'program:read',
  input: listSchema,
  handler: async ({ actor, input, tenant }) => {
    const { items, nextCursor } = await tenant((tx) =>
      listPrograms(tx, actor, {
        kind: 'template',
        cursor: input.cursor,
        q: input.q,
        status: input.status,
      }),
    );
    return new ApiResult(items, { meta: { nextCursor } });
  },
};

const createSchema = z.object({ title: z.string().trim().min(1).max(120) });

export const programsPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'program:write',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant, track }) => {
    const created = await tenant((tx) => createProgram(tx, actor, input, { requestId }));
    track('program_created');
    return new ApiResult(created, { status: 201 });
  },
};

export const programGetRoute: RouteDef<undefined, true> = {
  can: 'program:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => getProgram(tx, actor, params.id ?? '')),
};

// `weeks` is validated in depth by commitProgramVersion (one source of truth); its failures land on fieldErrors.weeks.
const patchSchema = z.object({
  expectedVersion: z.number().int().min(1).nullable(),
  title: z.string().trim().min(1).max(120).optional(),
  weeks: z.array(z.unknown()).optional(),
});

/**
 * `expectedVersion` guards the commit: it is compared (under a row lock) only when `weeks` is present.
 * A rename alone never conflicts. A rename and a stale commit in one request roll back together.
 */
export const programPatchRoute: RouteDef<typeof patchSchema, true> = {
  can: 'program:write',
  input: patchSchema,
  handler: ({ actor, input, params, requestId, tenant }) => {
    const id = params.id ?? '';
    return tenant(async (tx) => {
      if (input.title === undefined && input.weeks === undefined) {
        throw new DomainError('VALIDATION', 'Some fields are invalid.', {
          _form: ['Provide a title or weeks to change.'],
        });
      }
      if (input.title !== undefined) await renameProgram(tx, actor, id, input.title, { requestId });
      if (input.weeks !== undefined) {
        await commitProgramVersion(
          tx,
          actor,
          {
            programId: id,
            expectedVersionNo: input.expectedVersion,
            weeks: input.weeks as WeekInput[],
          },
          { requestId },
        );
      }
      return getProgram(tx, actor, id);
    });
  },
};

export const programDraftGetRoute: RouteDef<undefined, true> = {
  can: 'program:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => getDraft(tx, actor, params.id ?? '')),
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

// Only the outer shape is checked here and in core: drafts hold raw, possibly invalid editor state.
const draftSchema = z.object({
  baseVersionNo: z.number().int().min(1).nullable(),
  title: z.string().max(120).optional(),
  weeks: z.array(z.unknown()),
});

/** Autosave target: 60 writes/min per user. */
export const programDraftPutRoute: RouteDef<typeof draftSchema, true> = {
  can: 'program:write',
  input: draftSchema,
  rateLimit: { capacity: 60, refillPerSecond: 1 },
  handler: async ({ actor, input, params, tenant }) => {
    const save = () => tenant((tx) => saveDraft(tx, actor, params.id ?? '', input));
    try {
      return await save();
    } catch (error) {
      // Two first saves racing on the draft's unique indexes can still raise P2002 (Postgres aborts the transaction,
      // so it cannot be retried inside it). One retry in a fresh transaction finds the row and updates it: last
      // write wins (Ruling 4).
      if (isUniqueViolation(error)) return save();
      throw error;
    }
  },
};

export const programDraftDeleteRoute: RouteDef<undefined, true> = {
  can: 'program:write',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => discardDraft(tx, actor, params.id ?? ''));
    return new ApiResult(null, { status: 204 });
  },
};

export const programVersionsListRoute: RouteDef<undefined, true> = {
  can: 'program:read',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => listProgramVersions(tx, actor, params.id ?? '')),
};

export const programVersionGetRoute: RouteDef<undefined, true> = {
  can: 'program:read',
  handler: ({ actor, params, tenant }) => {
    // Anything but a positive integer is an unknown version.
    const versionNo = /^[1-9]\d{0,8}$/.test(params.no ?? '') ? Number(params.no) : 0;
    return tenant((tx) => getProgram(tx, actor, params.id ?? '', { versionNo }));
  },
};

/** `POST /api/v1/programs/:id/duplicate`: a new template from the current version (PRD C13). */
export const programDuplicateRoute: RouteDef<undefined, true> = {
  can: 'program:write',
  handler: async ({ actor, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) => duplicateTemplate(tx, actor, params.id ?? '', { requestId })),
      { status: 201 },
    ),
};

const archiveSchema = z.object({ archived: z.boolean() });

/** `PUT /api/v1/programs/:id/archive`: archive or restore a template (PRD C13). */
export const programArchiveRoute: RouteDef<typeof archiveSchema, true> = {
  can: 'program:write',
  input: archiveSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => setTemplateArchived(tx, actor, params.id ?? '', input.archived, { requestId })),
};
