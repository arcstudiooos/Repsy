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
type NonTenantDelegate = Uncapitalize<(typeof NON_TENANT_MODELS)[number]>;

/** User relations that lead into NON_TENANT_MODELS. */
const NON_TENANT_RELATIONS: ReadonlySet<string> = new Set([
  'accounts',
  'sessions',
  'createdPilotCodes',
  'usedPilotCodes',
]);

const notInTenantScope = (what: string) =>
  new Error(`${what} is not available in a tenant scope; use withSystem in system code`);

/**
 * Rejects include/select/where/data trees that traverse into auth tables:
 * any key naming an auth relation (also under nested create/connect/update/
 * upsert/... keys and array elements), and a bare `_count: true`, which counts
 * every relation of the model including the auth ones.
 */
function rejectNonTenantRelations(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) rejectNonTenantRelations(item);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (NON_TENANT_RELATIONS.has(key)) throw notInTenantScope(`Relation ${key}`);
    if (key === '_count' && value === true) throw notInTenantScope('Relation count');
    rejectNonTenantRelations(value);
  }
}

type Args = Record<string, unknown> & { where?: Record<string, unknown> };

function scopeWhere(args: Args, orgId: string): Args {
  return { ...args, where: { ...args.where, organizationId: orgId } };
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

function tenantExtension(orgId: string) {
  return Prisma.defineExtension({
    name: 'tenant',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query: typedQuery }) {
          const query = typedQuery as (args: unknown) => Promise<unknown>;
          const a = args as Args;
          if (NON_TENANT_SET.has(model)) throw notInTenantScope(`Model ${model}`);
          rejectNonTenantRelations(a.include);
          rejectNonTenantRelations(a.select);
          rejectNonTenantRelations(a.where);
          rejectNonTenantRelations(a.data);
          rejectNonTenantRelations(a.create);
          rejectNonTenantRelations(a.update);
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
  return client.$extends(tenantExtension(orgId));
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
  return scoped(client, orgId).$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    if (options.userId !== undefined) {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${options.userId}, true)`;
    }
    return fn(tx);
  });
}

export type SystemTx = Prisma.TransactionClient;

/**
 * SYSTEM CODE ONLY (worker sweeps, auth bootstrap, seeding, test setup).
 * Bypasses tenant isolation by setting `app.bypass_rls = 'on'` for the
 * transaction. Never call this from request handlers acting for a user.
 */
export function withSystem<T>(
  fn: (tx: SystemTx) => Promise<T>,
  client: PrismaClient = defaultPrisma,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn(tx);
  });
}
