export const CORE_VERSION = '0.0.0';
export type { EmailMessage, EmailPort } from './ports/email';
export { enqueueEmail, type EnqueueEmailInput } from './outbox';
export { createLogger, logger, type Logger } from './log';
