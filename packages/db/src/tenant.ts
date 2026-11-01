import { Prisma, type PrismaClient } from './generated/client';
import { prisma as defaultPrisma } from './client';

/**
 * Isolation boundary: Postgres Row-Level Security (see the row_level_security
 * migration). The Prisma extension below is defense in depth.
 */

/** Models carrying an `organizationId` column. */
const scalarFields = Prisma as unknown as Record<string, Record<string, string> | undefined>;
const TENANT_MODELS: ReadonlySet<string> = new Set(
  Object.values(Prisma.ModelName).filter(
    (model) => scalarFields[`${model}ScalarFieldEnum`]?.organizationId !== undefined,
  ),
);

/**
 * Platform/auth tables (no organization_id, no RLS): credentials, sessions,
 * tokens, rate limits, pilot codes. Never reachable from a tenant scope.
 */
const NON_TENANT_MODELS = ['Account', 'Session', 'Verification', 'RateLimit', 'PilotCode'] as const;
const NON_TENANT_SET: ReadonlySet<string> = new Set(NON_TENANT_MODELS);

/**
 * Tenant models whose rows with a null `organizationId` are a shared global catalog.
 * Reads see the org's rows OR the globals; writes still inject the org, and
 * updates/deletes stay scoped to the org so they can never match a global row
 * (RLS enforces the same, see the exercises migration). Names are Prisma model names.
 */
export const GLOBAL_READABLE_MODELS = ['Exercise'] as const;
const GLOBAL_READABLE_SET: ReadonlySet<string> = new Set(GLOBAL_READABLE_MODELS);
type NonTenantDelegate = Uncapitalize<(typeof NON_TENANT_MODELS)[number]>;

const notInTenantScope = (what: string) =>
  new Error(`${what} is not available in a tenant scope; use withSystem in system code`);

/** model -> (relation field name -> target model), from Prisma's runtime data model. */
export type RelationMap = ReadonlyMap<string, ReadonlyMap<string, string>>;

interface RuntimeDataModel {
  models: Record<string, { fields: { name: string; kind: string; type: string }[] }>;
}

export function buildRelationMap(dataModel: RuntimeDataModel): RelationMap {
  return new Map(
    Object.entries(dataModel.models).map(([model, { fields }]) => [
      model,
      new Map(fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type])),
    ]),
  );
}

/**
 * Prisma 7 exposes no public DMMF on the generated client; every client
 * instance carries the runtime data model privately. Fail closed if absent.
 */
const relationMaps = new WeakMap<object, RelationMap>();
function relationMapOf(client: PrismaClient): RelationMap {
  const cached = relationMaps.get(client);
  if (cached) return cached;
  const dataModel = (client as unknown as { _runtimeDataModel?: RuntimeDataModel })
    ._runtimeDataModel;
  if (!dataModel) throw new Error('Prisma runtime data model unavailable; tenant guard cannot run');
  const built = buildRelationMap(dataModel);
  relationMaps.set(client, built);
  return built;
}

/**
 * Walks include/select/where/orderBy/having/data trees together with the
 * current model. Throws when a key is a relation of the current model that
 * targets an auth table (Account, Session, ...), or when `_count: true` is
 * used on a model that has such a relation. Relation fields recurse with their
 * target model; operator keys (select, AND, create, connect, ...) and arrays
 * keep the current model. A same-named relation to a non-auth model passes.
 */
export function rejectAuthRelations(relations: RelationMap, model: string, node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) rejectAuthRelations(relations, model, item);
    return;
  }
  const fields = relations.get(model);
  for (const [key, value] of Object.entries(node)) {
    const target = fields?.get(key);
    if (target !== undefined) {
      if (NON_TENANT_SET.has(target)) throw notInTenantScope(`Relation ${key}`);
      rejectAuthRelations(relations, target, value);
      continue;
    }
    if (key === '_count' && value === true) {
      for (const t of fields?.values() ?? []) {
        if (NON_TENANT_SET.has(t)) throw notInTenantScope('Relation count');
      }
    }
    rejectAuthRelations(relations, model, value);
  }
}

type Args = Record<string, unknown> & { where?: Record<string, unknown> };

function scopeWhere(args: Args, orgId: string): Args {
  return { ...args, where: { ...args.where, organizationId: orgId } };
}

/** Read filter for global-readable models: own rows or globals. AND-ed so a caller's own filters survive. */
function scopeGlobalReadWhere(args: Args, orgId: string): Args {
  const where = args.where ?? {};
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return {
    ...args,
    where: {
      ...where,
      AND: [...and, { OR: [{ organizationId: orgId }, { organizationId: null }] }],
    },
  };
}

/** Organization is keyed on `id`; AND-ing keeps a caller's unique key intact. */
function scopeOrganizationWhere(args: Args, orgId: string): Args {
  const where = args.where ?? {};
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...args, where: { ...where, AND: [...and, { id: orgId }] } };
}

function rejectRelation(data: object): void {
  if ('organization' in data) {
    throw new Error('Setting the organization relation is not allowed in a tenant scope');
  }
}

function scopeCreateData(data: unknown, orgId: string): unknown {
  const scope = (row: object) => {
    rejectRelation(row);
    return { ...row, organizationId: orgId };
  };
  return Array.isArray(data) ? data.map(scope) : scope(data as object);
}

/** Updates must never move a row to another org. */
function scopeUpdateData(data: unknown): unknown {
  const rest = { ...(data as Record<string, unknown>) };
  delete rest.organizationId;
  rejectRelation(rest);
  return rest;
}

function tenantExtension(orgId: string, relations: RelationMap) {
  return Prisma.defineExtension({
    name: 'tenant',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query: typedQuery }) {
          const query = typedQuery as (args: unknown) => Promise<unknown>;
          const a = args as Args;
          if (NON_TENANT_SET.has(model)) throw notInTenantScope(`Model ${model}`);
          rejectAuthRelations(relations, model, a.include);
          rejectAuthRelations(relations, model, a.select);
          rejectAuthRelations(relations, model, a.where);
          rejectAuthRelations(relations, model, a.orderBy);
          rejectAuthRelations(relations, model, a.having);
          rejectAuthRelations(relations, model, a.data);
          rejectAuthRelations(relations, model, a.create);
          rejectAuthRelations(relations, model, a.update);
          if (model === 'Organization') {
            switch (operation) {
              case 'create':
              case 'createMany':
              case 'createManyAndReturn':
              case 'upsert':
                throw new Error(
                  `Operation ${operation} is not allowed on Organization in a tenant scope`,
                );
              case 'update':
              case 'updateMany':
              case 'updateManyAndReturn':
                return query(
                  scopeOrganizationWhere({ ...a, data: scopeUpdateData(a.data) }, orgId),
                );
              default:
                return query(scopeOrganizationWhere(a, orgId));
            }
          }
          if (!TENANT_MODELS.has(model)) return query(args);
          switch (operation) {
            case 'create':
            case 'createMany':
            case 'createManyAndReturn':
              return query({ ...a, data: scopeCreateData(a.data, orgId) });
            case 'upsert':
              return query({
                ...scopeWhere(a, orgId),
                create: scopeCreateData(a.create, orgId),
                update: scopeUpdateData(a.update),
              });
            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
              return query(scopeWhere({ ...a, data: scopeUpdateData(a.data) }, orgId));
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
              return query(
                GLOBAL_READABLE_SET.has(model)
                  ? scopeGlobalReadWhere(a, orgId)
                  : scopeWhere(a, orgId),
              );
            case 'delete':
            case 'deleteMany':
              return query(scopeWhere(a, orgId));
            default:
              throw new Error(`Operation ${operation} is not allowed on tenant-scoped client`);
          }
        },
      },
    },
  });
}

function scoped(client: PrismaClient, orgId: string) {
  return client.$extends(tenantExtension(orgId, relationMapOf(client)));
}

type ScopedClient = ReturnType<typeof scoped>;

/**
 * Transaction-bound, tenant-scoped client handed to `withTenant` callbacks.
 * Auth/platform tables are omitted (and rejected at runtime); `user` is
 * limited by users RLS to members of the org plus the acting user's own row.
 */
export type TenantTx = Omit<
  ScopedClient,
  | NonTenantDelegate
  | '$connect'
  | '$disconnect'
  | '$on'
  | '$transaction'
  | '$extends'
  | '$queryRaw'
  | '$queryRawUnsafe'
  | '$executeRaw'
  | '$executeRawUnsafe'
>;

export interface TenantOptions {
  /**
   * The acting user. Sets `app.user_id` so users RLS lets the actor see (and
   * update) their own row even without a membership row match.
   */
  userId?: string;
  /** Interactive-transaction timeout in ms (Prisma's default is 5 000). For worker jobs that read or write a lot. */
  timeout?: number;
}

/**
 * Runs `fn` in a transaction scoped to `orgId`: the first statement sets
 * `app.org_id` (and `app.user_id` when given; both enforced by RLS), and the
 * client also injects `organizationId`.
 */
export function withTenant<T>(
  orgId: string,
  fn: (tx: TenantTx) => Promise<T>,
  client: PrismaClient = defaultPrisma,
  options: TenantOptions = {},
): Promise<T> {
  return scoped(client, orgId).$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      if (options.userId !== undefined) {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${options.userId}, true)`;
      }
      return fn(tx);
    },
    options.timeout === undefined ? undefined : { timeout: options.timeout },
  );
}

export type SystemTx = Prisma.TransactionClient;

/**
 * SYSTEM CODE ONLY (worker sweeps, auth bootstrap, seeding, test setup).
 * Bypasses tenant isolation by setting `app.bypass_rls = 'on'` for the
 * transaction. Never call this from request handlers acting for a user,
 * except the sanctioned request-path uses below. Each one runs before an active
 * organization exists (or spans the user's organizations) and touches only rows
 * keyed by the caller's own user id or by a secret they hold. Add a line here
 * before adding another.
 *
 * - `findInviteByTokenHash` (db/invites.ts): an invitee has no membership yet; one invite, looked up by token hash.
 * - `acceptInvite` (core/invites): pre-membership; authorized solely by possession of the invite token.
 * - `acceptWithSignup` (web lib/accept-invite.ts) user lookups: checks the just-created user row exists (Better
 *   Auth fakes one for a taken email), marks it emailVerified (the invite proved the mailbox) and purges its
 *   pending verification mail; users/outbox rows of that one new user only.
 * - select-org page (web app/select-org): names of the organizations the user is a member of, to choose one.
 * - `loadMemberships` (web server/actor.ts): the user's own memberships across orgs, to resolve the active org.
 * - `hasCoachMembership` (web lib/membership.ts): whether the user has any owner/coach membership (proxy and
 *   onboarding gates), before an org is chosen.
 * - `registerCoach` / `redeemPilotCode` / `deleteUser` (web lib/register-coach.ts) and auth bootstrap (web
 *   lib/auth.ts outbox enqueue): sign-up creates the user's first organization and membership, checks/uses a pilot
 *   code (platform table), undoes a half-finished sign-up, and enqueues platform auth emails; no org exists yet.
 * - `lookupTeamInvite` / `acceptTeamInvite` (core team/team.ts, web app/team/join, PRD A10): a teammate has no
 *   membership yet; one invite, looked up by token hash, joined only by the signed-in account with its verified email.
 * - `calendarFeed` (core calendar/feed.ts, web app/calendar/[token], PRD L7): finds the one client whose calendar
 *   feed token hashes to the one presented (the token is the credential, as for an invite), then reads their workouts
 *   in that client's own organization scope.
 * - `releaseEndpoint` (web server/routes/push.ts, PRD H11): before saving the caller's push subscription, deletes
 *   another user's row for the same browser endpoint (a shared device). Keyed by the endpoint, an unguessable
 *   capability URL the caller's own browser holds; it only ever removes rows, never reads them.
 *
 * Platform-admin console (S5-3): cross-organization by design, so the rule above does not hold; instead every use
 * goes through `withPlatformAdmin` (web server/platformAdmin.ts), which authorizes the authenticated user as a
 * platform admin before it opens this transaction (non-admins get 404 with no database access), and each core admin
 * function (`core/admin`) asserts it again inside. Every mutation and every support read is audited.
 * - web server/routes/privacy.ts admin routes (`requirePlatformAdmin`, checked right after authentication): pilot
 *   codes (list, create), account lookup, the deletion queue (list, verify / reject / hold), support grants (list,
 *   grant, revoke) and the grant-gated support read of one client.
 * - web app/admin/page.tsx (the console: pilot codes, account lookup, deletion queue, own grants) and
 *   web app/admin/support/[clientId]/page.tsx (the grant-gated support read); each calls `notFound()` first.
 * A client's or owner's own deletion request is a tenant operation (`withTenant`), not system scope.
 * apps/web/test/platform-admin.test.ts fails when a web module starts calling `withSystem` or `withPlatformAdmin`
 * without a line here.
 */
export function withSystem<T>(
  fn: (tx: SystemTx) => Promise<T>,
  client: PrismaClient = defaultPrisma,
  options: Pick<TenantOptions, 'timeout'> = {},
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    },
    options.timeout === undefined ? undefined : { timeout: options.timeout },
  );
}
