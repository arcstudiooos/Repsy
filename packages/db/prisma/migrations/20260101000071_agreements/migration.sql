-- PRD B14: versioned terms and waivers a client accepts in the portal. Acceptances are evidence: insert-only.
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agreements_id_organization_id_key" ON "agreements"("id", "organization_id");
CREATE INDEX "agreements_organization_id_idx" ON "agreements"("organization_id");
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("body") BETWEEN 1 AND 20000 AND "version" >= 1
);

CREATE TABLE "agreement_acceptances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "client_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agreement_acceptances_agreement_id_version_client_id_key" ON "agreement_acceptances"("agreement_id", "version", "client_id");
CREATE INDEX "agreement_acceptances_organization_id_client_id_idx" ON "agreement_acceptances"("organization_id", "client_id");
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_agreement_id_organization_id_fkey" FOREIGN KEY ("agreement_id", "organization_id") REFERENCES "agreements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- As for messages (000030): DELETE only under app.lawful_erasure (the erasure job), never UPDATE or TRUNCATE.
CREATE FUNCTION agreement_acceptances_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'agreement acceptances are insert-only: % is not allowed', TG_OP;
END;
$$;
CREATE TRIGGER agreement_acceptances_no_change
  BEFORE UPDATE OR DELETE ON "agreement_acceptances"
  FOR EACH ROW EXECUTE FUNCTION agreement_acceptances_reject_change();
CREATE TRIGGER agreement_acceptances_no_truncate
  BEFORE TRUNCATE ON "agreement_acceptances"
  FOR EACH STATEMENT EXECUTE FUNCTION agreement_acceptances_reject_change();

ALTER TABLE "agreements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agreements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agreements" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
ALTER TABLE "agreement_acceptances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agreement_acceptances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agreement_acceptances" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
