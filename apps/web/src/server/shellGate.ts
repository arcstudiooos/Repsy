import type { ErrorCode, MembershipRef, Role } from '@kinetic/core';

/** What resolving the actor for the active org produced: a role, or the DomainError code it threw. */
export type ActorOutcome = { role: Role } | { error: ErrorCode };

/**
 * Where a shell sends a signed-in, verified user whose active org does not fit it (null = render the shell).
 * Coach shell: a client role in the active org goes to /portal. Portal: a coach role goes to /app.
 * Both: no active org chosen among several (ORG_SELECTION_REQUIRED) or a stale org cookie (NOT_FOUND) goes to the
 * workspace chooser; no workspace at all goes to `/`, which routes by role (or to pilot-code recovery).
 */
export function shellRedirect(shell: 'coach' | 'portal', outcome: ActorOutcome): string | null {
  if ('error' in outcome) {
    return outcome.error === 'ORG_SELECTION_REQUIRED' || outcome.error === 'NOT_FOUND'
      ? '/select-org'
      : '/';
  }
  const isClient = outcome.role === 'client';
  if (shell === 'coach') return isClient ? '/portal' : null;
  return isClient ? null : '/app';
}

/** The "Switch workspace" entry shows only for users who belong to two or more organizations. */
export const canSwitchWorkspace = (memberships: readonly MembershipRef[]): boolean =>
  new Set(memberships.map((m) => m.orgId)).size >= 2;
