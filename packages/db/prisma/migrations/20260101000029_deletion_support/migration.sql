-- S5-3 deletion requests and support access (D-006, D-008 #16/#19, D-010 #4). Composite (client, organization) FKs;
-- forced RLS (the admin console reads them in system scope). One open deletion request per client.
--
-- Lawful erasure (D-008 #16: immutability forbids silent edits, not lawful erasure): set_log_revisions stays
-- append-only for UPDATE and TRUNCATE always, and for DELETE unless the transaction set app.lawful_erasure = 'on',
-- which only the deletion job does (transaction-local).

-- CreateEnum
CREATE TYPE "deletion_status" AS ENUM ('requested', 'verified', 'processing', 'done', 'rejected');

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject_client_id" UUID NOT NULL,
    "subject_user_id" UUID,
    "requested_by" UUID NOT NULL,
    "status" "deletion_status" NOT NULL DEFAULT 'requested',
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "rejected_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_access_grants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deletion_requests_status_created_at_idx" ON "deletion_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "deletion_requests_organization_id_idx" ON "deletion_requests"("organization_id");

-- CreateIndex
CREATE INDEX "support_access_grants_admin_user_id_client_id_expires_at_idx" ON "support_access_grants"("admin_user_id", "client_id", "expires_at");

-- CreateIndex
CREATE INDEX "support_access_grants_organization_id_idx" ON "support_access_grants"("organization_id");

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_subject_client_id_organization_id_fkey" FOREIGN KEY ("subject_client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX "deletion_requests_one_open_per_client" ON "deletion_requests"("subject_client_id")
  WHERE "status" IN ('requested', 'verified', 'processing');

ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_reason_check" CHECK (
  "rejected_reason" IS NULL OR char_length("rejected_reason") BETWEEN 1 AND 500
);
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_reason_check" CHECK (
  char_length("reason") BETWEEN 1 AND 500
);

CREATE OR REPLACE FUNCTION set_log_revisions_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'set_log_revisions is append-only: % is not allowed', TG_OP;
END;
$$;

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deletion_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deletion_requests" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_access_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "support_access_grants" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
