import { DomainError } from '../errors';
import { MANAGER_ROLES, STAFF_ROLES, TRAINER_ROLES, type ActorContext, type Role } from './actor';

const STAFF = STAFF_ROLES;
const TRAINER = TRAINER_ROLES;
const MANAGER = MANAGER_ROLES;

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
  | 'note:write'
  | 'analytics:read'
  | 'metric:read'
  | 'metric:write'
  | 'habit:read'
  | 'habit:manage'
  | 'habit:log'
  | 'nutrition:read'
  | 'nutrition:manage'
  | 'nutrition:log'
  | 'export:org'
  | 'export:self'
  // R3 remaining (D-013): new actions for scheduling/domains/lapse/billing.
  // Existing R3 code still uses the older actions above; these are the
  // re-pointing targets and are safe to grant now.
  | 'billing:manage'
  | 'scheduling:read'
  | 'scheduling:manage'
  | 'scheduling:book'
  | 'assistant:use'
  | 'lapse:read'
  | 'lapse:record';

const POLICY: Record<Action, readonly Role[]> = {
  'org:read': [...STAFF],
  'org:update': [...TRAINER],
  'settings:org:update': [...MANAGER],
  'client:read': [...STAFF],
  'client:create': [...TRAINER],
  'client:update': [...TRAINER],
  'exercise:read': [...STAFF],
  'exercise:create': [...TRAINER],
  'program:read': [...STAFF],
  'program:write': [...TRAINER],
  'assignment:read': [...STAFF],
  'assignment:write': [...TRAINER],
  // Clients too, but core scopes a client to their own sessions (sessions/read.ts `sessionScope`).
  'session:read': [...STAFF, 'client'],
  'session:log': [...STAFF, 'client'],
  'review:read': [...STAFF],
  'review:update': [...STAFF],
  'checkin:manage': [...TRAINER],
  // Clients too, scoped to their own check-ins and thread by core.
  'checkin:read': [...STAFF, 'client'],
  'checkin:submit': ['client'],
  'message:read': [...STAFF, 'client'],
  'message:send': [...STAFF, 'client'],
  // Internal notes never reach a client (S4-5).
  'note:read': [...STAFF],
  'note:write': [...STAFF],
  'analytics:read': [...STAFF],
  // Body metrics (PRD E1): clients too, scoped by core to their own record.
  'metric:read': [...STAFF, 'client'],
  'metric:write': [...STAFF, 'client'],
  // Habits and tasks (PRD G1-G3): coaches assign them; clients tick their own (core scopes a client to their record).
  'habit:read': [...STAFF, 'client'],
  'habit:manage': [...TRAINER],
  'habit:log': [...STAFF, 'client'],
  // Nutrition (PRD G6/G7): coaches set targets; clients log their own totals (core scopes a client to their record).
  'nutrition:read': [...STAFF, 'client'],
  'nutrition:manage': [...TRAINER],
  'nutrition:log': [...STAFF, 'client'],
  // D-010 #4: the owner exports the organization; a client exports their own data.
  'export:org': ['owner'],
  'export:self': ['client'],
  'billing:manage': [...TRAINER],
  'scheduling:read': [...STAFF, 'client'],
  'scheduling:manage': [...TRAINER],
  'scheduling:book': [...STAFF, 'client'],
  /** PRD I15: the read-only AI assistant. Each tool also checks its own screen's policy. */
  'assistant:use': [...STAFF],
  'lapse:read': [...STAFF, 'client'],
  'lapse:record': [...MANAGER],
};

export const can = (actor: ActorContext, action: Action): boolean =>
  POLICY[action].includes(actor.role);

export function assertCan(actor: ActorContext, action: Action): void {
  if (!can(actor, action)) throw new DomainError('FORBIDDEN', 'You do not have access to this.');
}
