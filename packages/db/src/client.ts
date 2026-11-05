import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

/**
 * Session setting that lets a connection see every `users` row (users RLS,
 * migration users_rls). Set only on the dedicated Better Auth pool.
 */
const AUTH_CONTEXT_OPTIONS = '-c app.auth_context=on';

export function createPrismaClient(
  connectionString: string,
  schema?: string,
  options: { authContext?: boolean } = {},
): PrismaClient {
  // A non-default schema (test databases) is also the search_path, so raw SQL that names app functions resolves
  // the same way Prisma's qualified table names do. It goes into libpq options unquoted: a plain identifier only, so
  // no value can add further `-c` settings (PR #2 review D M7).
  if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error('createPrismaClient: schema must be a plain lowercase identifier');
  }
  const settings = [
    ...(options.authContext ? [AUTH_CONTEXT_OPTIONS] : []),
    ...(schema ? [`-c search_path=${schema},public`] : []),
  ].join(' ');
  const adapter = new PrismaPg(
    settings ? { connectionString, options: settings } : { connectionString },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter, transactionOptions: transactionOptionsFromEnv(process.env) });
}

/**
 * Interactive-transaction limits. Prisma's defaults (wait 2 s for a connection, 5 s per transaction) are kept unless
 * DB_TX_MAX_WAIT_MS / DB_TX_TIMEOUT_MS are set: a small host (Render free, 0.1 CPU) needs more room for the dashboard's
 * one-transaction read. A per-call `timeout` (withTenant options) still wins.
 */
export function transactionOptionsFromEnv(env: Record<string, string | undefined>): {
  maxWait?: number;
  timeout?: number;
} {
  const ms = (v: string | undefined) => {
    const n = Number(v);
    return v?.trim() && Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const maxWait = ms(env.DB_TX_MAX_WAIT_MS);
  const timeout = ms(env.DB_TX_TIMEOUT_MS);
  return { ...(maxWait ? { maxWait } : {}), ...(timeout ? { timeout } : {}) };
}

/**
 * AUTH ONLY: a client whose connections may read and write every `users` row.
 * Better Auth looks users up by email/id before any tenant is known and runs
 * outside withTenant, so it gets its own pool. Tenant tables stay fail-closed
 * on it (only the users policy honours app.auth_context). Never hand this
 * client to request handlers or domain code.
 */
export function createAuthPrismaClient(connectionString: string, schema?: string): PrismaClient {
  return createPrismaClient(connectionString, schema, { authContext: true });
}

function lazyClient(create: (url: string) => PrismaClient): PrismaClient {
  let instance: PrismaClient | undefined;
  const get = (): PrismaClient => {
    if (!instance) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set');
      instance = create(url);
    }
    return instance;
  };
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const client = get();
      const value = Reflect.get(client, prop, client) as unknown;
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}

/** Lazily-connected shared client; resolves DATABASE_URL on first use. */
export const prisma: PrismaClient = lazyClient((url) => createPrismaClient(url));

/** Lazily-connected Better Auth client (see createAuthPrismaClient). */
export const authPrisma: PrismaClient = lazyClient((url) => createAuthPrismaClient(url));
