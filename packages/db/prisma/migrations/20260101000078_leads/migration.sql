-- PRD B15, B16: a workspace's public page (/join/<slug>) with an application form, and the lead pipeline behind it.
-- The page is off until the owner or an admin turns it on. A visitor has no membership, so the slug is resolved by
-- app_org_by_public_slug (only for an enabled page, returning only the id); the rest runs in that organization's
-- tenant scope.
ALTER TABLE "organizations" ADD COLUMN "public_slug" TEXT;
ALTER TABLE "organizations" ADD COLUMN "public_bio" TEXT;
ALTER TABLE "organizations" ADD COLUMN "public_offers" TEXT;
ALTER TABLE "organizations" ADD COLUMN "public_page_enabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "organizations_public_slug_key" ON "organizations"("public_slug");
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_public_slug_check" CHECK (
  "public_slug" IS NULL OR "public_slug" ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'
);

CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT NOT NULL DEFAULT '',
    "converted_client_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leads_organization_id_status_idx" ON "leads"("organization_id", "status");
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_client_id_organization_id_fkey" FOREIGN KEY ("converted_client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_check" CHECK (
  "status" IN ('new', 'contacted', 'call_booked', 'won', 'lost')
  AND length("name") BETWEEN 1 AND 120 AND length("email") BETWEEN 3 AND 320
  AND length("message") <= 4000 AND length("notes") <= 4000
);

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leads" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

DO $do$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE FUNCTION %1$I.app_org_by_public_slug(target text)
      RETURNS uuid
      LANGUAGE plpgsql VOLATILE
      SET search_path = %1$I, pg_temp
      AS $body$
      DECLARE
        prior_bypass text := pg_catalog.current_setting('app.bypass_rls', true);
        result uuid;
      BEGIN
        PERFORM pg_catalog.set_config('app.bypass_rls', 'on', true);
        SELECT o.id FROM %1$I.organizations o
         WHERE o.public_slug OPERATOR(pg_catalog.=) target AND o.public_page_enabled
          INTO result;
        PERFORM pg_catalog.set_config('app.bypass_rls', COALESCE(prior_bypass, ''), true);
        RETURN result;
      END
      $body$
  $f$, pg_catalog.current_schema());
END
$do$;
