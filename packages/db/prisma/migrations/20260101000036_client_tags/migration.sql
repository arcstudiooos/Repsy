-- PRD B4 client tags: workspace tags (unique name per organization, case-insensitively) and their links to clients.
-- Composite tenant FKs; deleting a tag removes its links; forced RLS.

-- CreateEnum
CREATE TYPE "tag_color" AS ENUM ('teal', 'blue', 'purple', 'orange', 'red', 'gray');

-- CreateTable
CREATE TABLE "client_tags" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" "tag_color" NOT NULL DEFAULT 'teal',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_tag_links" (
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_tag_links_pkey" PRIMARY KEY ("client_id","tag_id")
);

-- CreateIndex
CREATE INDEX "client_tags_organization_id_idx" ON "client_tags"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_tags_id_organization_id_key" ON "client_tags"("id", "organization_id");

-- CreateIndex
CREATE INDEX "client_tag_links_tag_id_idx" ON "client_tag_links"("tag_id");

-- CreateIndex
CREATE INDEX "client_tag_links_organization_id_idx" ON "client_tag_links"("organization_id");

-- AddForeignKey
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tag_links" ADD CONSTRAINT "client_tag_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tag_links" ADD CONSTRAINT "client_tag_links_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tag_links" ADD CONSTRAINT "client_tag_links_tag_id_organization_id_fkey" FOREIGN KEY ("tag_id", "organization_id") REFERENCES "client_tags"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_name_check" CHECK (char_length("name") BETWEEN 1 AND 40);
CREATE UNIQUE INDEX "client_tags_org_name_key" ON "client_tags"("organization_id", lower("name"));

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "client_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_tags" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "client_tag_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_tag_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_tag_links" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
