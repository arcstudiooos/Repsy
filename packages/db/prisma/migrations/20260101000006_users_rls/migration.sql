-- users is not tenant-owned, but it must not be listable across tenants.
-- Visible rows:
--   * the acting user's own row (app.user_id, set by withTenant when known);
--   * users with a membership in the active org (app.org_id); the memberships
--     subquery is itself filtered by memberships' tenant policy;
--   * everything under app.bypass_rls (system code, see withSystem);
--   * everything under app.auth_context: set at connection start only on the
--     dedicated Better Auth pool (see createAuthPrismaClient), which must look
--     users up by email before any tenant is known.
-- Writes from a tenant scope are limited to the acting user's own row.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY users_visible ON "users" FOR SELECT
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR current_setting('app.auth_context', true) = 'on'
    OR id::text = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1 FROM "memberships" m
       WHERE m.user_id = "users".id
         AND m.organization_id::text = current_setting('app.org_id', true)
    )
  );

CREATE POLICY users_write ON "users" FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR current_setting('app.auth_context', true) = 'on'
    OR id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR current_setting('app.auth_context', true) = 'on'
    OR id::text = current_setting('app.user_id', true)
  );
