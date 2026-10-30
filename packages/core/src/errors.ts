/** Codes the API layer maps to HTTP statuses. Domain codes outside this map surface as 500 unless added here. */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  /** A client's 24h log edit window (S3-4) has passed. */
  EDIT_WINDOW_CLOSED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ORG_SELECTION_REQUIRED: 409,
  ALREADY_ONBOARDED: 409,
  CLIENT_LIMIT_REACHED: 409,
  ACTIVE_ASSIGNMENT_EXISTS: 409,
  EMAIL_TAKEN: 409,
  SESSION_NOT_STARTED: 409,
  SESSION_FINISHED: 409,
  VALIDATION: 422,
  PILOT_CODE_INVALID: 422,
  INVITE_INVALID: 404,
  INVITE_EXPIRED: 410,
  INVITE_USED: 410,
  INVITE_REVOKED: 410,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

/** Expected, user-facing failure. `apiHandler` maps it to the `{error}` envelope. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly fieldErrors?: Record<string, string[]>,
    /** Machine-readable extras the API serializes as `error.details` (e.g. `currentVersionNo` on a 409). */
    public readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}
