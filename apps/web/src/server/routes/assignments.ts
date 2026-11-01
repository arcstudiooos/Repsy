import { z } from 'zod';
import {
  assignProgram,
  BULK_MAX_CLIENTS,
  DomainError,
  getAssignmentSummary,
  type IsoWeekday,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
const assignSchema = z.object({
  clientId: z.string().min(1).max(64),
  startLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  readinessConfirmed: z.boolean(),
  confirmReplace: z.boolean(),
});

/** `:id` is the template program. Copy-on-assign and session generation run in one tenant transaction. */
export const assignPostRoute: RouteDef<typeof assignSchema, true> = {
  can: 'assignment:write',
  input: assignSchema,
  handler: async ({ actor, input, params, requestId, tenant, track, clientHash }) => {
    const result = await tenant((tx) =>
      assignProgram(
        tx,
        actor,
        {
          clientId: input.clientId,
          templateProgramId: params.id ?? '',
          startLocalDate: input.startLocalDate,
          weekdays: input.weekdays as IsoWeekday[],
          readinessConfirmed: input.readinessConfirmed,
          confirmReplace: input.confirmReplace,
        },
        { requestId },
      ),
    );
    track('program_assigned', {
      client_id_hash: clientHash(input.clientId),
      weekday_count: input.weekdays.length,
    });
    return new ApiResult(result, { status: 201 });
  },
};

/** `:id` is the client. `data` is null when the client has no active assignment. */
export const assignmentGetRoute: RouteDef<undefined, true> = {
  can: 'assignment:read',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => getAssignmentSummary(tx, actor, params.id ?? '')),
};

const bulkAssignSchema = z.object({
  clientIds: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX_CLIENTS),
  startLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  readinessConfirmed: z.boolean(),
});

/**
 * `POST /api/v1/programs/:id/assign-many` (PRD B5): the template to many clients, each their own copy and in their
 * own transaction, so one client's problem never undoes another's assignment. Clients with an active program are
 * skipped (never replaced in bulk) and reported with the reason.
 */
export const assignManyRoute: RouteDef<typeof bulkAssignSchema, true> = {
  can: 'assignment:write',
  input: bulkAssignSchema,
  handler: async ({ actor, input, params, requestId, tenant, track, clientHash }) => {
    const assigned: string[] = [];
    const skipped: { clientId: string; reason: string }[] = [];
    for (const clientId of [...new Set(input.clientIds)]) {
      try {
        await tenant((tx) =>
          assignProgram(
            tx,
            actor,
            {
              clientId,
              templateProgramId: params.id ?? '',
              startLocalDate: input.startLocalDate,
              weekdays: input.weekdays as IsoWeekday[],
              readinessConfirmed: input.readinessConfirmed,
              confirmReplace: false,
            },
            { requestId },
          ),
        );
        assigned.push(clientId);
        track('program_assigned', {
          client_id_hash: clientHash(clientId),
          weekday_count: input.weekdays.length,
        });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const field = Object.values(error.fieldErrors ?? {})[0]?.[0];
        skipped.push({ clientId, reason: field ?? error.message });
      }
    }
    return { assigned, skipped };
  },
};
