import { z } from 'zod';
import { assignProgram, getAssignmentSummary, type IsoWeekday } from '@kinetic/core';
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
