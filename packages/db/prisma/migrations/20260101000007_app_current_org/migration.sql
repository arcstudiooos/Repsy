-- Shared RLS helpers. Every tenant policy reads:
--   organization_id = app_current_org() OR app_rls_bypass()
--
-- app_current_org(): NULL (so no rows match) when app.org_id is unset or empty.
-- A non-empty value that is not a uuid raises SQLSTATE 22P02 (invalid_text_representation)
-- on the cast. That is accepted fail-closed behaviour: the statement errors, nothing leaks.
-- Comparing uuid to uuid also lets the planner use the organization_id indexes (no ::text cast).
-- Functions are STABLE and PUBLIC-executable (default); they read settings only.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(current_setting('app.bypass_rls', true) = 'on', false) $$;

DROP POLICY tenant_isolation ON "memberships";
CREATE POLICY tenant_isolation ON "memberships" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

DROP POLICY tenant_isolation ON "audit_events";
CREATE POLICY tenant_isolation ON "audit_events" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

DROP POLICY tenant_isolation ON "outbox_emails";
CREATE POLICY tenant_isolation ON "outbox_emails" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

DROP POLICY tenant_isolation ON "organizations";
CREATE POLICY tenant_isolation ON "organizations" FOR ALL
  USING (id = app_current_org() OR app_rls_bypass())
  WITH CHECK (id = app_current_org() OR app_rls_bypass());

-- users: same branches as before (bypass / auth_context / self / member of active org).
DROP POLICY users_visible ON "users";
DROP POLICY users_write ON "users";

CREATE POLICY users_visible ON "users" FOR SELECT
  USING (
    app_rls_bypass()
    OR current_setting('app.auth_context', true) = 'on'
    OR id::text = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1 FROM "memberships" m
       WHERE m.user_id = "users".id
         AND m.organization_id = app_current_org()
    )
  );

CREATE POLICY users_write ON "users" FOR ALL
  USING (
    app_rls_bypass()
    OR current_setting('app.auth_context', true) = 'on'
    OR id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    app_rls_bypass()
    OR current_setting('app.auth_context', true) = 'on'
    OR id::text = current_setting('app.user_id', true)
  );
