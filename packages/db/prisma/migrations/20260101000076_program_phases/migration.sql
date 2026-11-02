-- PRD C17, J5: phased programs. A client's queue of templates to run after the current program, in order. When the
-- running program's last planned workout has passed, the next phase starts (mode auto) or waits in the review queue
-- for the coach to approve (mode approve, J7). Starting a phase is an ordinary assignment (D-001, D-010 #2).
CREATE TABLE "program_phases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "template_program_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "assignment_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    CONSTRAINT "program_phases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "program_phases_organization_id_client_id_status_idx" ON "program_phases"("organization_id", "client_id", "status");
ALTER TABLE "program_phases" ADD CONSTRAINT "program_phases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_phases" ADD CONSTRAINT "program_phases_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_phases" ADD CONSTRAINT "program_phases_template_program_id_organization_id_fkey" FOREIGN KEY ("template_program_id", "organization_id") REFERENCES "programs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_phases" ADD CONSTRAINT "program_phases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_phases" ADD CONSTRAINT "program_phases_check" CHECK (
  "mode" IN ('auto', 'approve') AND "status" IN ('queued', 'started', 'cancelled') AND "position" >= 0
);

ALTER TABLE "program_phases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "program_phases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "program_phases" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TYPE "review_rule" ADD VALUE 'phase_ready';
