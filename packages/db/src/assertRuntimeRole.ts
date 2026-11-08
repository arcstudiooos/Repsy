import type { PrismaClient } from './generated/client';

interface RoleFacts {
  role: string;
  super: boolean;
  bypassRls: boolean;
  ownedTables: number;
}

/**
 * Refuses to run as a role that would defeat tenant isolation: a superuser or
 * BYPASSRLS role skips RLS entirely, and a table owner is exempt from RLS unless
 * FORCE is set. The runtime role (`repsy_app`) must be none of these; migrations
 * run as the owner via MIGRATION_DATABASE_URL.
 */
export async function assertRuntimeRole(
  prisma: PrismaClient,
  options: { schema?: string } = {},
): Promise<void> {
  const schema = options.schema ?? null;
  const rows = await prisma.$queryRaw<RoleFacts[]>`
    SELECT current_user::text AS role,
           r.rolsuper AS super,
           r.rolbypassrls AS "bypassRls",
           (SELECT count(*) FROM pg_tables t
             WHERE t.schemaname = COALESCE(${schema}, current_schema()) AND t.tableowner = current_user)::int AS "ownedTables"
      FROM pg_roles r
     WHERE r.rolname = current_user`;
  const facts = rows[0];
  if (!facts) throw new Error('Runtime role check failed: could not read the current role');
  const problems: string[] = [];
  if (facts.super) problems.push('is a superuser');
  if (facts.bypassRls) problems.push('has BYPASSRLS');
  if (facts.ownedTables > 0) problems.push(`owns ${facts.ownedTables} table(s) in the app schema`);
  if (problems.length > 0) {
    throw new Error(
      `Unsafe database role "${facts.role}": ${problems.join(', ')}. ` +
        'Run the app as the restricted repsy_app role (see docs/runbook.md).',
    );
  }
}

/** Startup hook: enforced in production or when ENFORCE_RUNTIME_ROLE=true. */
export async function assertRuntimeRoleIfEnforced(
  prisma: PrismaClient,
  env: Record<string, string | undefined> = process.env,
  options: { schema?: string } = {},
): Promise<void> {
  if (env.NODE_ENV === 'production' || env.ENFORCE_RUNTIME_ROLE === 'true') {
    // The owner credential must never be readable by the running app (runtime-role boundary).
    if (env.MIGRATION_DATABASE_URL) {
      throw new Error(
        'MIGRATION_DATABASE_URL must not be set in the runtime environment (owner credential). ' +
          'Unset it in the start command; it is for pre-deploy migrations only.',
      );
    }
    await assertRuntimeRole(prisma, options);
  }
}
