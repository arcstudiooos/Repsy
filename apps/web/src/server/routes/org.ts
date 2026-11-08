import { z } from 'zod';
import { appendAudit } from '@repsy/db';
import { DomainError } from '@repsy/core';
import type { RouteDef } from '../api';

const orgSelect = { id: true, name: true, timezone: true } as const;

/** The active organization, never one named by the client. */
export const orgGetRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: async ({ actor, tenant }) => {
    const org = await tenant((tx) =>
      tx.organization.findFirst({ where: { id: actor.orgId }, select: orgSelect }),
    );
    if (!org) throw new DomainError('NOT_FOUND', 'Not found.');
    return org;
  },
};

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
const patchSchema = z.object({ name: z.string().trim().min(1).max(120) });

export const orgPatchRoute: RouteDef<typeof patchSchema, true> = {
  can: 'org:update',
  input: patchSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant(async (tx) => {
      const org = await tx.organization.update({
        where: { id: actor.orgId },
        data: { name: input.name },
        select: orgSelect,
      });
      await appendAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        objectType: 'organization',
        objectId: actor.orgId,
        action: 'organization.updated',
        requestId,
      });
      return org;
    }),
};
