-- S3-4 set log revisions (Ruling 5): every change to a set log after its session was submitted, by the client within
-- 24 hours or by a coach (reason required). Tenant links are composite (fk, organization_id) FKs, so a revision can
-- never point at another organization's set log or session. Adding UNIQUE (id, organization_id) on set_logs is DDL
-- only. Revisions are append-only: UPDATE, DELETE and TRUNCATE are rejected by triggers (like audit_events), with no
-- exemption for system code or RLS bypass. Cleanup that drops the whole schema (tests) does not fire them.

-- CreateEnum
CREATE TYPE "set_log_revision_role" AS ENUM ('client', 'coach');

-- CreateTable
CREATE TABLE "set_log_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "set_log_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB NOT NULL,
    "reason" TEXT,
    "revised_by" UUID NOT NULL,
    "revised_by_role" "set_log_revision_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_log_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "set_log_revisions_session_id_created_at_idx" ON "set_log_revisions"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "set_log_revisions_organization_id_idx" ON "set_log_revisions"("organization_id");

-- CreateIndex
CREATE INDEX "set_log_revisions_set_log_id_idx" ON "set_log_revisions"("set_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "set_logs_id_organization_id_key" ON "set_logs"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "set_log_revisions" ADD CONSTRAINT "set_log_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_log_revisions" ADD CONSTRAINT "set_log_revisions_set_log_id_organization_id_fkey" FOREIGN KEY ("set_log_id", "organization_id") REFERENCES "set_logs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_log_revisions" ADD CONSTRAINT "set_log_revisions_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "workout_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_log_revisions" ADD CONSTRAINT "set_log_revisions_revised_by_fkey" FOREIGN KEY ("revised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A coach's reason is at most 500 characters (the API trims and validates it as well).
ALTER TABLE "set_log_revisions" ADD CONSTRAINT "set_log_revisions_reason_check" CHECK (
  "reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500
);

-- Append-only, enforced by the database.
CREATE FUNCTION set_log_revisions_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'set_log_revisions is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER set_log_revisions_no_update
  BEFORE UPDATE OR DELETE ON "set_log_revisions"
  FOR EACH ROW EXECUTE FUNCTION set_log_revisions_reject_change();
CREATE TRIGGER set_log_revisions_no_truncate
  BEFORE TRUNCATE ON "set_log_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION set_log_revisions_reject_change();

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "set_log_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "set_log_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "set_log_revisions" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
