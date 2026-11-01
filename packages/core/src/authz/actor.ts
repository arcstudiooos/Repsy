/** Most privileged first (`highestRole`). Admin and Assistant are the PRD A10 team roles (R3 team rollout). */
export const ROLES = ['owner', 'admin', 'coach', 'assistant', 'client'] as const;
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
  /** From the session user. Grants nothing by itself: platform-admin support access is explicit and audited. */
  isPlatformAdmin: boolean;
  /** The actor's client record in this org, once client records exist (Sprint 1). */
  clientId?: string;
}

/** Everyone on the coaching side of a workspace (the coach shell, not the portal). */
export const STAFF_ROLES = ['owner', 'admin', 'coach', 'assistant'] as const;
/** Staff who run the workspace: its settings, team, agreements and audit log. */
export const MANAGER_ROLES = ['owner', 'admin'] as const;
/** Staff who build and assign programs and manage clients (not assistants). */
export const TRAINER_ROLES = ['owner', 'admin', 'coach'] as const;

/** Kept for the coach shell: every staff role. */
export const COACH_ROLES: readonly Role[] = STAFF_ROLES;

export const isCoachRole = (role: Role): boolean => (STAFF_ROLES as readonly Role[]).includes(role);
export const isManager = (role: Role): boolean => (MANAGER_ROLES as readonly Role[]).includes(role);

/** When a user holds several roles in one org, the most privileged wins. */
export function highestRole(roles: readonly Role[]): Role | undefined {
  return ROLES.find((r) => roles.includes(r));
}
