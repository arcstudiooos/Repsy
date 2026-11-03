-- PRD L4 (D-013 #15): a workspace's own hostname for its public page and storefront, proved with a DNS TXT record
-- (`_repsy.<host>`), then registered with the email provider so client emails come from that domain once its DNS
-- records verify. Hostnames are unique across all workspaces. A request on a custom host is resolved by
-- app_public_slug_by_host (verified domains of enabled public pages only, returning only the slug).
CREATE TABLE "custom_domains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "verify_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "sending_status" TEXT NOT NULL DEFAULT 'none',
    "sending_ref" TEXT,
    "sending_records" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "custom_domains_hostname_key" ON "custom_domains"("hostname");
CREATE UNIQUE INDEX "custom_domains_organization_id_key" ON "custom_domains"("organization_id");
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_check" CHECK (
  "hostname" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  AND length("hostname") <= 253
  AND "verify_token" ~ '^[a-f0-9]{32}$'
  AND "status" IN ('pending', 'verified', 'failed')
  AND "sending_status" IN ('none', 'pending', 'verified', 'failed')
);

ALTER TABLE "custom_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_domains" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custom_domains" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

DO $do$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE FUNCTION %1$I.app_public_slug_by_host(target text)
      RETURNS text
      LANGUAGE sql STABLE
      SET app.bypass_rls = 'on'
      SET search_path = %1$I, pg_temp
      AS $body$
        SELECT o.public_slug FROM %1$I.custom_domains d
          JOIN %1$I.organizations o ON o.id OPERATOR(pg_catalog.=) d.organization_id
         WHERE d.hostname OPERATOR(pg_catalog.=) target
           AND d.status OPERATOR(pg_catalog.=) 'verified'
           AND o.public_page_enabled
      $body$
  $f$, pg_catalog.current_schema());
END
$do$;
