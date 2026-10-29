export const CORE_VERSION = '0.0.0';
export type { EmailMessage, EmailPort } from './ports/email';
export { enqueueEmail, enqueuePlatformEmail, type EnqueueEmailInput } from './outbox';
export { DomainError, httpStatusFor, ERROR_STATUS, type ErrorCode } from './errors';
export {
  ROLES,
  COACH_ROLES,
  isCoachRole,
  highestRole,
  type ActorContext,
  type MembershipRef,
  type Role,
} from './authz/actor';
export { can, assertCan, type Action } from './authz/policies';
export { enforceAttemptLimit, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS } from './identity/rateLimit';
export { signupCoach, hashPilotCode, type SignupCoachInput } from './identity/signupCoach';
export { createLogger, logger, type Logger } from './log';
