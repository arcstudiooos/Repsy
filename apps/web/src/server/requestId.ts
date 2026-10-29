const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a well-formed inbound `x-request-id` (proxy-assigned) so traces correlate; otherwise mints one. */
export function getRequestId(request: Request): string {
  const inbound = request.headers.get('x-request-id');
  return inbound !== null && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();
}
