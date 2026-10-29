/** Codes the API layer maps to HTTP statuses. Domain codes outside this map surface as 500 unless added here. */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ORG_SELECTION_REQUIRED: 409,
  ALREADY_ONBOARDED: 409,
  VALIDATION: 422,
  PILOT_CODE_INVALID: 422,
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
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}
