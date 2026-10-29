-- Row-Level Security is the tenant isolation boundary. Every table with an
-- organization_id column (and organizations, keyed on id) is fail-closed:
-- rows are visible/writable only when app.org_id matches, or app.bypass_rls
-- is 'on' (system code only, see withSystem). The application must connect
-- as a role that is not a superuser and does not have BYPASSRLS.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "memberships" FOR ALL
  USING (organization_id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (organization_id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_events" FOR ALL
  USING (organization_id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (organization_id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "outbox_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_emails" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_emails" FOR ALL
  USING (organization_id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (organization_id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "organizations" FOR ALL
  USING (id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (id::text = current_setting('app.org_id', true) OR current_setting('app.bypass_rls', true) = 'on');
