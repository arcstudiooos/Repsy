import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

/**
 * Session setting that lets a connection see every `users` row (users RLS,
 * migration users_rls). Set only on the dedicated Better Auth pool.
 */
const AUTH_CONTEXT_OPTIONS = '-c app.auth_context=on';

/** Requests queue for a connection this long before failing (Prisma's own default of 2 s fails under a burst). */
const DEFAULT_TX_MAX_WAIT_MS = 5_000;

/** Connections per pool: DB_POOL_MAX for the app client, DB_AUTH_POOL_MAX for the Better Auth client. */
export function poolSizeFromEnv(env: Record<string, string | undefined>, auth: boolean): number {
  const n = Number(auth ? env.DB_AUTH_POOL_MAX : env.DB_POOL_MAX);
  return Number.isInteger(n) && n > 0 ? n : auth ? 5 : 20;
}

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
    {
      connectionString,
      ...(settings ? { options: settings } : {}),
      max: poolSizeFromEnv(process.env, options.authContext === true),
    },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: DEFAULT_TX_MAX_WAIT_MS,
      ...transactionOptionsFromEnv(process.env),
    },
  });
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

/**
 * One client of each kind per process. Next.js bundles this module into several server chunks, each with its own
 * module scope: a plain module variable there created 7 clients at about 26 MB each, every one with its own pool.
 */
const processClients = globalThis as typeof globalThis & {
  __repsyPrismaClients?: Map<string, PrismaClient>;
};
processClients.__repsyPrismaClients ??= new Map();

function lazyClient(kind: string, create: (url: string) => PrismaClient): PrismaClient {
  const clients = processClients.__repsyPrismaClients as Map<string, PrismaClient>;
  const get = (): PrismaClient => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const key = `${kind}:${url}`;
    let instance = clients.get(key);
    if (!instance) {
      instance = create(url);
      clients.set(key, instance);
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
export const prisma: PrismaClient = lazyClient('app', (url) => createPrismaClient(url));

/** Lazily-connected Better Auth client (see createAuthPrismaClient). */
export const authPrisma: PrismaClient = lazyClient('auth', (url) => createAuthPrismaClient(url));
