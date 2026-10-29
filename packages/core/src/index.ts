export const CORE_VERSION = '0.0.0';
export type { EmailMessage, EmailPort } from './ports/email';
export { enqueueEmail, enqueuePlatformEmail, type EnqueueEmailInput } from './outbox';
export { DomainError } from './errors';
export { signupCoach, hashPilotCode, type SignupCoachInput } from './identity/signupCoach';
export { createLogger, logger, type Logger } from './log';
