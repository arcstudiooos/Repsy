import { Prisma, type PrismaClient } from './generated/client';
import { prisma as defaultPrisma } from './client';

/** Models carrying an `organizationId` column; every other model is untouched. */
const scalarFields = Prisma as unknown as Record<string, Record<string, string> | undefined>;
const TENANT_MODELS: ReadonlySet<string> = new Set(
  Object.values(Prisma.ModelName).filter(
    (model) => scalarFields[`${model}ScalarFieldEnum`]?.organizationId !== undefined,
  ),
);

type Args = Record<string, unknown> & { where?: Record<string, unknown> };

function scopeWhere(args: Args, orgId: string): Args {
  return { ...args, where: { ...args.where, organizationId: orgId } };
}

function scopeData(data: unknown, orgId: string): unknown {
  return Array.isArray(data)
    ? data.map((row: object) => ({ ...row, organizationId: orgId }))
    : { ...(data as object), organizationId: orgId };
}

function tenantExtension(orgId: string) {
  return Prisma.defineExtension({
    name: 'tenant',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query: typedQuery }) {
          const query = typedQuery as (args: unknown) => Promise<unknown>;
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = args as Args;
          switch (operation) {
            case 'create':
            case 'createMany':
            case 'createManyAndReturn':
              return query({ ...a, data: scopeData(a.data, orgId) });
            case 'upsert':
              return query({
                ...scopeWhere(a, orgId),
                create: scopeData(a.create, orgId),
                // an update must never move a row to another org
                update: { ...(a.update as object), organizationId: orgId },
              });
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
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

/** Transaction-bound, tenant-scoped client handed to `withTenant` callbacks. */
export type TenantTx = Omit<
  ScopedClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * Runs `fn` in a transaction with a client that injects `organizationId`
 * into reads/updates/deletes and sets it on creates.
 */
export function withTenant<T>(
  orgId: string,
  fn: (tx: TenantTx) => Promise<T>,
  client: PrismaClient = defaultPrisma,
): Promise<T> {
  return scoped(client, orgId).$transaction((tx) => fn(tx));
}
