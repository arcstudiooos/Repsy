-- S5-2 exports (D-010 #4): one row per requested export, idempotent per (organization, requester, key). Composite
-- (client_id, organization_id) FK (MATCH SIMPLE: null for organization exports); forced RLS.

-- CreateEnum
CREATE TYPE "export_scope" AS ENUM ('client_self', 'org');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "client_id" UUID,
    "scope" "export_scope" NOT NULL,
    "resource_type" TEXT NOT NULL DEFAULT 'csv_bundle',
    "status" "export_status" NOT NULL DEFAULT 'queued',
    "object_key" TEXT,
    "files_json" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "export_jobs_organization_id_requested_by_created_at_idx" ON "export_jobs"("organization_id", "requested_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_organization_id_requested_by_idempotency_key_key" ON "export_jobs"("organization_id", "requested_by", "idempotency_key");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A client's own export names the client; an organization export doesn't.
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_scope_check" CHECK (
  ("scope" = 'client_self') = ("client_id" IS NOT NULL)
);
-- Files are offered only once the job is done.
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_files_check" CHECK (
  "files_json" IS NULL OR "status" = 'done'
);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "export_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "export_jobs" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
