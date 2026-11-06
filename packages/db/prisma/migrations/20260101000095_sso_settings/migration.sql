-- PRD A16: single sign-on per workspace. Google Workspace or Microsoft Entra ID, tied to the workspace's
-- email domain (and, for Microsoft, its directory tenant). `enforced` blocks password sign-in for staff
-- whose email is on that domain.
CREATE TABLE "sso_settings" (
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "microsoft_tenant_id" TEXT,
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sso_settings_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "sso_settings_provider_check" CHECK ("provider" IN ('google', 'microsoft')),
    CONSTRAINT "sso_settings_tenant_check" CHECK ("provider" <> 'microsoft' OR "microsoft_tenant_id" IS NOT NULL)
);
ALTER TABLE "sso_settings" ADD CONSTRAINT "sso_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sso_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sso_settings" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
