import type { RouteDef } from '../api';

/** `{ data: { userId, memberships } }`. Works before an org is chosen, so it needs no active org. */
export const meRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: ({ user, memberships }) => ({
    userId: user.id,
    memberships: memberships.map(({ orgId, role }) => ({ orgId, role })),
  }),
};
