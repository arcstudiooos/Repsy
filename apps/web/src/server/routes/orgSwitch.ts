import { z } from 'zod';
import { DomainError, highestRole } from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

const schema = z.object({ orgId: z.uuid() });

/**
 * Makes `orgId` the active organization by setting the signed `repsy_org`
 * cookie. Only an active membership qualifies; anything else is a 404 so org
 * existence never leaks.
 */
export const orgSwitchRoute: RouteDef<typeof schema, false> = {
  requireOrg: false,
  input: schema,
  handler: ({ input, memberships, orgCookie }) => {
    const role = highestRole(memberships.filter((m) => m.orgId === input.orgId).map((m) => m.role));
    if (role === undefined) throw new DomainError('NOT_FOUND', 'Not found.');
    return new ApiResult(
      { orgId: input.orgId, role },
      { headers: { 'set-cookie': orgCookie(input.orgId) } },
    );
  },
};
