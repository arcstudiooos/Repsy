import { DomainError } from '../errors';
import type { ActorContext, Role } from './actor';

export type Action =
  | 'org:read'
  | 'org:update'
  | 'settings:org:update'
  | 'client:read'
  | 'client:create'
  | 'client:update'
  | 'exercise:read'
  | 'exercise:create'
  | 'program:read'
  | 'program:write'
  | 'assignment:read'
  | 'assignment:write'
  | 'session:read'
  | 'session:log'
  | 'review:read'
  | 'review:update'
  | 'checkin:manage'
  | 'checkin:read'
  | 'checkin:submit'
  | 'message:read'
  | 'message:send'
  | 'note:read'
  | 'note:write';

const POLICY: Record<Action, readonly Role[]> = {
  'org:read': ['owner', 'coach'],
  'org:update': ['owner', 'coach'],
  'settings:org:update': ['owner'],
  'client:read': ['owner', 'coach'],
  'client:create': ['owner', 'coach'],
  'client:update': ['owner', 'coach'],
  'exercise:read': ['owner', 'coach'],
  'exercise:create': ['owner', 'coach'],
  'program:read': ['owner', 'coach'],
  'program:write': ['owner', 'coach'],
  'assignment:read': ['owner', 'coach'],
  'assignment:write': ['owner', 'coach'],
  // Clients too, but core scopes a client to their own sessions (sessions/read.ts `sessionScope`).
  'session:read': ['owner', 'coach', 'client'],
  'session:log': ['owner', 'coach', 'client'],
  'review:read': ['owner', 'coach'],
  'review:update': ['owner', 'coach'],
  'checkin:manage': ['owner', 'coach'],
  // Clients too, scoped to their own check-ins and thread by core.
  'checkin:read': ['owner', 'coach', 'client'],
  'checkin:submit': ['client'],
  'message:read': ['owner', 'coach', 'client'],
  'message:send': ['owner', 'coach', 'client'],
  // Internal notes never reach a client (S4-5).
  'note:read': ['owner', 'coach'],
  'note:write': ['owner', 'coach'],
};

export const can = (actor: ActorContext, action: Action): boolean =>
  POLICY[action].includes(actor.role);

export function assertCan(actor: ActorContext, action: Action): void {
  if (!can(actor, action)) throw new DomainError('FORBIDDEN', 'You do not have access to this.');
}
