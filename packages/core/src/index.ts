export const CORE_VERSION = '0.0.0';
export type { EmailMessage, EmailPort } from './ports/email';
export {
  enqueueEmail,
  enqueuePlatformEmail,
  type EnqueueEmailInput,
  type EmailRecipient,
} from './outbox';
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
export { signupCoach, type SignupCoachInput } from './identity/signupCoach';
export { generatePilotCode, hashPilotCode, normalizePilotCode } from './identity/pilotCode';
export { createLogger, logger, type Logger } from './log';
export { encodeCursor, decodeCursor, PAGE_SIZE, type CursorRow } from './pagination';
export {
  createClient,
  listClients,
  getClient,
  updateClient,
  toClientView,
  escapeLike,
  type ClientView,
  type ClientStatus,
} from './clients/clients';
export {
  issueInvite,
  revokeInvite,
  acceptInvite,
  classifyInvite,
  summarizeInvites,
  INVITE_TTL_MS,
  type InviteClass,
  type InviteStatus,
  type AcceptInviteInput,
} from './invites/invites';
export { newInviteToken, hashInviteToken } from './invites/token';
