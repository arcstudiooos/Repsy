import { z } from 'zod';
import {
  assertCan,
  DomainError,
  httpStatusFor,
  logger,
  type Action,
  type ActorContext,
  type ErrorCode,
  type MembershipRef,
} from '@kinetic/core';
import { prisma as defaultPrisma, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import { auth as defaultAuth, getSessionUser, type Auth, type SessionUser } from '@/lib/auth';
import { loadMemberships, resolveActor } from './actor';
import { orgCookieSecret, serializeOrgCookie } from './orgCookie';
import { defaultLimiter, InMemoryRateLimiter, type RateLimiter } from './rateLimit';
import { clientIp } from './clientIp';
import { getRequestId } from './requestId';

export interface ApiDeps {
  auth?: Pick<Auth, 'api'>;
  prisma?: PrismaClient;
  /** Org-cookie signing key; defaults to ORG_COOKIE_SECRET / BETTER_AUTH_SECRET. */
  secret?: string;
  /** Trusted origin for CSRF checks; defaults to APP_BASE_URL. */
  appBaseUrl?: string;
  limiter?: RateLimiter;
}

type InputOf<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteCtx<I, R extends boolean> {
  request: Request;
  requestId: string;
  user: SessionUser;
  /** Active org + role, from a validated membership. Undefined only when `requireOrg: false`. */
  actor: R extends true ? ActorContext : undefined;
  /** All of the user's active memberships. */
  memberships: MembershipRef[];
  input: I;
  /** Dynamic route segments (e.g. `id`), already decoded by Next. Empty when none. */
  params: Record<string, string>;
  /** The Prisma client this handler runs on (injected in tests, the shared one otherwise). */
  prisma: PrismaClient;
  /** The Better Auth instance this handler runs on (injected in tests, the shared one otherwise). */
  auth: Pick<Auth, 'api'>;
  /**
   * For `requireOrg: false` routes that still want the active org when there is one:
   * the resolved actor, or undefined when no organization is active (none chosen, none joined).
   */
  optionalActor(): ActorContext | undefined;
  /** Runs `fn` in a transaction scoped to the actor's organization. */
  tenant<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  /** `Set-Cookie` value that makes `orgId` this user's active organization (signed, user-bound). */
  orgCookie(orgId: string): string;
}

/** Return from a handler to set `meta` or a non-200 status. A bare return value becomes `data`. */
export class ApiResult {
  constructor(
    readonly data: unknown,
    readonly options: {
      meta?: Record<string, unknown>;
      status?: number;
      headers?: Record<string, string>;
    } = {},
  ) {}
}

export interface RouteDef<S extends z.ZodType | undefined, R extends boolean> {
  /** Zod schema for the JSON body (non-GET) or query string (GET). Unknown keys are stripped. */
  input?: S;
  /** Default true. `false` for routes that work before an org is chosen (e.g. /me). */
  requireOrg?: R;
  /** Authorization policy checked against the resolved actor. Requires an active org. */
  can?: Action;
  /**
   * Per-route token bucket (per user, or per IP when anonymous). Replaces the
   * global bucket for this route; omit to use the global per-user default.
   */
  rateLimit?: { capacity: number; refillPerSecond: number };
  handler(ctx: RouteCtx<InputOf<S>, R>): unknown;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function fail(
  code: ErrorCode,
  message: string,
  requestId: string,
  extra: {
    fieldErrors?: Record<string, string[]>;
    details?: Record<string, string | number | boolean | null>;
    headers?: Record<string, string>;
  } = {},
): Response {
  const error: Record<string, unknown> = { code, message, requestId };
  if (extra.fieldErrors) error.fieldErrors = extra.fieldErrors;
  if (extra.details) error.details = extra.details;
  return Response.json(
    { error },
    {
      status: httpStatusFor(code),
      headers: { 'x-request-id': requestId, ...extra.headers },
    },
  );
}

function trustedOrigin(request: Request, deps: ApiDeps): string {
  const configured = deps.appBaseUrl ?? process.env.APP_BASE_URL;
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV === 'production') throw new Error('APP_BASE_URL is required');
  return new URL(request.url).origin;
}

function isSecure(request: Request, deps: ApiDeps): boolean {
  return trustedOrigin(request, deps).startsWith('https://');
}

async function readInput(request: Request, schema: z.ZodType): Promise<unknown> {
  let raw: unknown;
  if (SAFE_METHODS.has(request.method)) {
    raw = Object.fromEntries(new URL(request.url).searchParams);
  } else {
    const text = await request.text();
    try {
      raw = text === '' ? {} : (JSON.parse(text) as unknown);
    } catch {
      throw new DomainError('BAD_REQUEST', 'Request body must be valid JSON.');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const fieldErrors: Record<string, string[]> = { ...flat.fieldErrors };
    if (flat.formErrors.length > 0) fieldErrors._form = flat.formErrors;
    throw new DomainError('VALIDATION', 'Some fields are invalid.', fieldErrors);
  }
  return parsed.data;
}

/** Stack with the `name: message` header (which may span lines) replaced by the name. */
function sanitizedStack(err: Error): string {
  const stack = err.stack ?? '';
  const header = `${err.name}: ${err.message}`;
  if (stack.startsWith(header)) return err.name + stack.slice(header.length);
  const firstFrame = stack.search(/^\s+at /m);
  return firstFrame === -1 ? err.name : `${err.name}\n${stack.slice(firstFrame)}`;
}

export function createApiHandler(deps: ApiDeps = {}) {
  return function define<S extends z.ZodType | undefined = undefined, R extends boolean = true>(
    def: RouteDef<S, R>,
  ): (
    request: Request,
    context?: { params?: Promise<Record<string, string>> | Record<string, string> },
  ) => Promise<Response> {
    if (def.can !== undefined && def.requireOrg === false) {
      throw new Error(
        'apiHandler: `can` needs an active org; it cannot be used with requireOrg: false',
      );
    }
    const routeLimiter = def.rateLimit ? new InMemoryRateLimiter(def.rateLimit) : undefined;
    return async (request, context) => {
      const requestId = getRequestId(request);
      try {
        if (!SAFE_METHODS.has(request.method)) {
          // CSRF: browsers always send Origin on cross-site mutations.
          if (request.headers.get('origin') !== trustedOrigin(request, deps)) {
            return fail('FORBIDDEN', 'Cross-origin request rejected.', requestId);
          }
        }

        const user = await getSessionUser(request.headers, deps.auth);
        const limiter = routeLimiter ?? deps.limiter ?? defaultLimiter;
        const limit = await limiter.consume(
          user ? `user:${user.id}` : `ip:${clientIp(request.headers)}`,
        );
        if (!limit.allowed) {
          return fail('RATE_LIMITED', 'Too many requests. Try again shortly.', requestId, {
            headers: { 'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) },
          });
        }
        if (!user) return fail('UNAUTHENTICATED', 'Sign in to continue.', requestId);

        const memberships = await loadMemberships(user.id, deps.prisma);

        const requireOrg = def.requireOrg !== false;
        const secret = deps.secret ?? orgCookieSecret();
        const actor = requireOrg
          ? resolveActor(request.headers.get('cookie'), user, memberships, secret)
          : undefined;
        const runTenant = <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
          withTenant(orgId, fn, deps.prisma, { userId: user.id });
        // A client's own Client row id, so handlers can scope to "my data" without trusting input.
        if (actor?.role === 'client') {
          const own = await runTenant(actor.orgId, (tx) =>
            // An archived client has no access to this organization (D-010 #4): no clientId, so core finds nothing.
            tx.client.findFirst({
              where: { userId: user.id, status: { not: 'archived' } },
              select: { id: true },
            }),
          );
          if (own) actor.clientId = own.id;
        }
        if (actor && def.can) assertCan(actor, def.can);

        const input = def.input ? await readInput(request, def.input) : undefined;

        const result = await def.handler({
          request,
          requestId,
          user,
          actor,
          memberships,
          input,
          params: (await context?.params) ?? {},
          prisma: deps.prisma ?? defaultPrisma,
          auth: deps.auth ?? defaultAuth,
          optionalActor: () => {
            try {
              return resolveActor(request.headers.get('cookie'), user, memberships, secret);
            } catch (error) {
              if (error instanceof DomainError) return undefined;
              throw error;
            }
          },
          tenant: (fn) => {
            if (!actor) throw new Error('tenant() requires an active organization');
            return runTenant(actor.orgId, fn);
          },
          orgCookie: (orgId) => serializeOrgCookie(user.id, orgId, secret, isSecure(request, deps)),
        } as RouteCtx<InputOf<S>, R>);

        const { data, options } =
          result instanceof ApiResult
            ? { data: result.data, options: result.options }
            : { data: result, options: {} };
        if (options.status === 204) {
          return new Response(null, {
            status: 204,
            headers: { ...options.headers, 'x-request-id': requestId },
          });
        }
        return Response.json(options.meta ? { data, meta: options.meta } : { data }, {
          status: options.status ?? 200,
          headers: { 'x-request-id': requestId, ...options.headers },
        });
      } catch (error) {
        if (error instanceof DomainError) {
          return fail(error.code, error.message, requestId, {
            fieldErrors: error.fieldErrors,
            details: error.details,
          });
        }
        // Never log err.message: it can carry client PII (e.g. Prisma echoes values).
        // Stack goes to logs only, never to the response.
        const err = error instanceof Error ? error : undefined;
        logger.error(
          {
            requestId,
            errName: err?.name ?? 'unknown',
            ...(err && 'code' in err && typeof err.code === 'string' ? { errCode: err.code } : {}),
            ...(err?.stack ? { stack: sanitizedStack(err) } : {}),
          },
          'unhandled API error',
        );
        return fail('INTERNAL', 'Something went wrong.', requestId);
      }
    };
  };
}

/** Production handler factory: reads env lazily on each request. */
export const apiHandler = createApiHandler();
