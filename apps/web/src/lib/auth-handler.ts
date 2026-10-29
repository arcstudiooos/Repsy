import type { Auth } from './auth';

/** Better Auth codes that are input-validation failures (API contract: 422, not 400). */
const VALIDATION_CODES = new Set([
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_COMPROMISED',
  'INVALID_EMAIL',
  'VALIDATION_ERROR',
]);

async function withValidationStatus(response: Response): Promise<Response> {
  if (response.status !== 400) return response;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null;
  if (!body?.code || !VALIDATION_CODES.has(body.code)) return response;
  return new Response(response.body, {
    status: 422,
    statusText: 'Unprocessable Entity',
    headers: response.headers,
  });
}

export function createAuthHandlers(instance: Pick<Auth, 'handler'>) {
  // Resolved per request so the lazy `auth` is not built at import/build time.
  const handle = async (request: Request) => withValidationStatus(await instance.handler(request));
  return { GET: handle, POST: handle };
}
