import { DomainError } from '../errors';
import type { ActorContext, Role } from './actor';

export type Action = 'org:read' | 'org:update';

const POLICY: Record<Action, readonly Role[]> = {
  'org:read': ['owner', 'coach'],
  'org:update': ['owner', 'coach'],
};

export const can = (actor: ActorContext, action: Action): boolean =>
  POLICY[action].includes(actor.role);

export function assertCan(actor: ActorContext, action: Action): void {
  if (!can(actor, action)) throw new DomainError('FORBIDDEN', 'You do not have access to this.');
}
