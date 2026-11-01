import { z } from 'zod';
import {
  changeTeamRole,
  inviteTeammate,
  listTeam,
  removeTeammate,
  revokeTeamInvite,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/team` (PRD A10): the workspace's staff and, for owners and admins, open invites. */
export const teamGetRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: ({ actor, tenant }) => tenant((tx) => listTeam(tx, actor)),
};

const inviteSchema = z.object({ email: z.string().max(320), role: z.string().max(20) });

/** `POST /api/v1/team/invites`: email an invite to join as admin, coach or assistant. */
export const teamInviteRoute: RouteDef<typeof inviteSchema, true> = {
  can: 'org:read',
  input: inviteSchema,
  rateLimit: { capacity: 20, refillPerSecond: 20 / 3600 },
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => inviteTeammate(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

/** `DELETE /api/v1/team/invites/:id`. */
export const teamInviteDeleteRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => revokeTeamInvite(tx, actor, params.id, { requestId }));
    return { revoked: true };
  },
};

const roleSchema = z.object({ role: z.string().max(20) });

/** `PUT /api/v1/team/members/:id`: change a teammate's role. */
export const teamMemberPutRoute: RouteDef<typeof roleSchema, true> = {
  can: 'org:read',
  input: roleSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    await tenant((tx) => changeTeamRole(tx, actor, params.id, input.role, { requestId }));
    return { role: input.role };
  },
};

/** `DELETE /api/v1/team/members/:id`: remove someone from the team. */
export const teamMemberDeleteRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => removeTeammate(tx, actor, params.id, { requestId }));
    return { removed: true };
  },
};
