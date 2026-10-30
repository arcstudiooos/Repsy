-- S3-1 program drafts: one autosaved, unvalidated builder state per program (Ruling 4: last write wins). The composite
-- (program_id, organization_id) FK keeps a draft in its program's org and deletes it with the program.

-- CreateTable
CREATE TABLE "program_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "base_version_no" INTEGER,
    "draft_json" JSONB NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "program_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "program_drafts_program_id_key" ON "program_drafts"("program_id");

-- CreateIndex
CREATE INDEX "program_drafts_organization_id_idx" ON "program_drafts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_drafts_program_id_organization_id_key" ON "program_drafts"("program_id", "organization_id");

-- AddForeignKey
ALTER TABLE "program_drafts" ADD CONSTRAINT "program_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_drafts" ADD CONSTRAINT "program_drafts_program_id_organization_id_fkey" FOREIGN KEY ("program_id", "organization_id") REFERENCES "programs"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_drafts" ADD CONSTRAINT "program_drafts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "program_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "program_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "program_drafts" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
