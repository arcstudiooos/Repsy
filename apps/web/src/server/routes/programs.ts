import { z } from 'zod';
import {
  commitProgramVersion,
  createProgram,
  discardDraft,
  DomainError,
  getDraft,
  getProgram,
  listProgramVersions,
  listPrograms,
  renameProgram,
  saveDraft,
  type WeekInput,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
const listSchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
});

export const programsListRoute: RouteDef<typeof listSchema, true> = {
  can: 'program:read',
  input: listSchema,
  handler: async ({ actor, input, tenant }) => {
    const { items, nextCursor } = await tenant((tx) =>
      listPrograms(tx, actor, { kind: 'template', cursor: input.cursor }),
    );
    return new ApiResult(items, { meta: { nextCursor } });
  },
};

const createSchema = z.object({ title: z.string().trim().min(1).max(120) });

export const programsPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'program:write',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant }) => {
    const created = await tenant((tx) => createProgram(tx, actor, input, { requestId }));
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
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => saveDraft(tx, actor, params.id ?? '', input)),
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
