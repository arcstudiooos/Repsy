import { getSessionUser, type Auth } from './auth';

/** `{data}` / `{error}` envelope (global constraints); 401 when there is no live session. */
export async function meResponse(
  headers: Headers,
  instance?: Pick<Auth, 'api'>,
): Promise<Response> {
  const user = await getSessionUser(headers, instance);
  if (!user) {
    return Response.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sign in to continue.',
          requestId: crypto.randomUUID(),
        },
      },
      { status: 401 },
    );
  }
  return Response.json({ data: user });
}
