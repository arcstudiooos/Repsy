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
  type AnalyticsPort,
  type EventName,
  type EventValue,
  assertWorkspaceAccess,
} from '@kinetic/core';
import { prisma as defaultPrisma, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import { auth as defaultAuth, getSessionUser, type Auth, type SessionUser } from '@/lib/auth';
import { loadMemberships, resolveActor } from './actor';
import { platformAdminOf } from './platformAdmin';
import { orgCookieSecret, serializeOrgCookie } from './orgCookie';
import { defaultLimiter, InMemoryRateLimiter, type RateLimiter } from './rateLimit';
import { clientIp } from './clientIp';
import { getRequestId } from './requestId';
import { analyticsHashSecret, clientHash, defaultAnalytics, eventFor } from './analytics';

export interface ApiDeps {
  auth?: Pick<Auth, 'api'>;
  prisma?: PrismaClient;
  /** Org-cookie signing key; defaults to ORG_COOKIE_SECRET / BETTER_AUTH_SECRET. */
  secret?: string;
  /** Trusted origin for CSRF checks; defaults to APP_BASE_URL. */
  appBaseUrl?: string;
  limiter?: RateLimiter;
  /** Product analytics (S5-4); the PostHog adapter (no-op without POSTHOG_KEY) by default. */
  analytics?: AnalyticsPort;
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
  /** Sends a §13 product event for the acting user (hashed ids, allowlisted properties only). */
  track(name: EventName, properties?: Record<string, EventValue>): void;
  /** `client_id_hash` for an event about a client. */
  clientHash(clientId: string): string;
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
   * Platform-admin console route (S5-3): anyone else gets 404 NOT_FOUND straight after authentication, before any
   * database access (memberships, system scope) or input validation. Requires `requireOrg: false`.
   */
  requirePlatformAdmin?: boolean;
  /**
   * Per-route token bucket (per user, or per IP when anonymous). Replaces the
   * global bucket for this route; omit to use the global per-user default.
   */
  rateLimit?: { capacity: number; refillPerSecond: number };
  /**
   * PRD M12 (D-013 #16): `true` is still allowed while a lapsed workspace can be read (requesting an export, a
   * deletion request, support); `'always'` even after the read window closes (listing and downloading prepared
   * exports, cancelling a payment plan). Every other write is refused, and reads close after the window.
   */
  allowWhenLapsed?: boolean | 'always';
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
    if (def.requirePlatformAdmin && def.requireOrg !== false) {
      throw new Error('apiHandler: requirePlatformAdmin routes must set requireOrg: false');
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
        if (def.requirePlatformAdmin) platformAdminOf(user);

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
        if (actor) {
          await assertWorkspaceAccess(deps.prisma ?? defaultPrisma, actor, {
            write: !SAFE_METHODS.has(request.method),
            exempt: def.allowWhenLapsed,
          });
        }

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
          // Runs after the request's work committed: an analytics fault never fails the request (PR #2 C M-5).
          track: (name, properties) => {
            try {
              (deps.analytics ?? defaultAnalytics()).capture(
                eventFor(
                  analyticsHashSecret(),
                  { userId: user.id, orgId: actor?.orgId },
                  name,
                  properties,
                ),
              );
            } catch (error) {
              logger.error(
                { requestId, errName: error instanceof Error ? error.name : 'unknown' },
                'analytics event dropped',
              );
            }
          },
          clientHash: (clientId) => clientHash(analyticsHashSecret(), clientId),
        } as RouteCtx<InputOf<S>, R>);

        // A raw response (a file download, an OAuth redirect) passes through with the request id. Copy its headers
        // first: `Response.redirect()` returns immutable ones, which would throw on set.
        if (result instanceof Response) {
          const headers = new Headers(result.headers);
          headers.set('x-request-id', requestId);
          return new Response(result.body, {
            status: result.status,
            statusText: result.statusText,
            headers,
          });
        }
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
        // §13 error_visible: the code and the route pattern only.
        try {
          (deps.analytics ?? defaultAnalytics()).capture(
            eventFor(analyticsHashSecret(), { userId: 'anonymous' }, 'error_visible', {
              code: 'INTERNAL',
              route: new URL(request.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id'),
            }),
          );
        } catch {
          // Analytics never turns an error response into another error.
        }
        return fail('INTERNAL', 'Something went wrong.', requestId);
      }
    };
  };
}

/** Production handler factory: reads env lazily on each request. */
export const apiHandler = createApiHandler();
