import { clearOrgCookie } from '../server/orgCookie';
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

/** Signing out also forgets the active organization, so the next user of this browser starts clean. */
function withOrgCookieCleared(request: Request, response: Response): Response {
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/sign-out')) return response;
  const headers = new Headers(response.headers);
  headers.append('set-cookie', clearOrgCookie(url.protocol === 'https:'));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createAuthHandlers(instance: Pick<Auth, 'handler'>) {
  // Resolved per request so the lazy `auth` is not built at import/build time.
  const handle = async (request: Request) =>
    withOrgCookieCleared(request, await withValidationStatus(await instance.handler(request)));
  return { GET: handle, POST: handle };
}
