/** Expected, user-facing failure. Task 0.4 extends this with API mapping. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}
