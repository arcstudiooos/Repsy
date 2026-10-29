export const ROLES = ['owner', 'coach', 'client'] as const;
export type Role = (typeof ROLES)[number];

export interface MembershipRef {
  orgId: string;
  role: Role;
}

/**
 * Who is acting, and in which organization. Built server-side only, from the
 * session plus a validated membership. Never from client-supplied org ids.
 */
export interface ActorContext {
  userId: string;
  orgId: string;
  role: Role;
}

export const COACH_ROLES: readonly Role[] = ['owner', 'coach'];

export const isCoachRole = (role: Role): boolean => COACH_ROLES.includes(role);

/** When a user holds several roles in one org, the most privileged wins. */
export function highestRole(roles: readonly Role[]): Role | undefined {
  return ROLES.find((r) => roles.includes(r));
}
