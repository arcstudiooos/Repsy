-- PRD G5: a resource library of links and short texts shared with all clients, a tag or one client. Forced RLS.

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "body" TEXT,
    "audience" TEXT NOT NULL,
    "tag_id" UUID,
    "client_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resources_organization_id_archived_at_idx" ON "resources"("organization_id", "archived_at");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_tag_id_organization_id_fkey" FOREIGN KEY ("tag_id", "organization_id") REFERENCES "client_tags"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "resources" ADD CONSTRAINT "resources_title_check" CHECK (char_length("title") BETWEEN 1 AND 120);
ALTER TABLE "resources" ADD CONSTRAINT "resources_url_check" CHECK ("url" IS NULL OR ("url" ~ '^https://' AND char_length("url") <= 500));
ALTER TABLE "resources" ADD CONSTRAINT "resources_body_check" CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 4000);
ALTER TABLE "resources" ADD CONSTRAINT "resources_content_check" CHECK ("url" IS NOT NULL OR "body" IS NOT NULL);
ALTER TABLE "resources" ADD CONSTRAINT "resources_audience_check" CHECK (
  ("audience" = 'all' AND "tag_id" IS NULL AND "client_id" IS NULL)
  OR ("audience" = 'tag' AND "tag_id" IS NOT NULL AND "client_id" IS NULL)
  OR ("audience" = 'client' AND "tag_id" IS NULL AND "client_id" IS NOT NULL)
);

ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "resources" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
