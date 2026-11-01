-- PRD B3: a reusable workspace link for in-person sign-ups, capped and revocable. Someone who opens it gives their
-- name and email and gets the usual single-use invite email, so verification and consent stay as they are. Only the
-- sha256 of the token is stored.
CREATE TABLE "join_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "join_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "join_links_token_hash_key" ON "join_links"("token_hash");
CREATE INDEX "join_links_organization_id_created_at_idx" ON "join_links"("organization_id", "created_at");
ALTER TABLE "join_links" ADD CONSTRAINT "join_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "join_links" ADD CONSTRAINT "join_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "join_links" ADD CONSTRAINT "join_links_uses_check" CHECK ("max_uses" BETWEEN 1 AND 200 AND "uses" BETWEEN 0 AND "max_uses");

ALTER TABLE "join_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "join_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "join_links" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
