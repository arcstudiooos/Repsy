-- S4-2 review flags (F10, D-008 #11): "Needs review" items raised by rules (missed workouts, overdue and new
-- check-ins, unread messages) and coach follow-ups. One row per (organization, dedupe key), so every raise is
-- idempotent. Composite (client_id, organization_id) FK; forced RLS.

-- CreateEnum
CREATE TYPE "review_rule" AS ENUM ('missed_workouts', 'checkin_overdue', 'checkin_new', 'message_unread', 'coach_followup');

-- CreateEnum
CREATE TYPE "review_flag_state" AS ENUM ('open', 'snoozed', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "review_flags" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "rule_key" "review_rule" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'needs_review',
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "dedupe_key" TEXT NOT NULL,
    "evidence_json" JSONB NOT NULL,
    "source_due_at" TIMESTAMPTZ(3),
    "state" "review_flag_state" NOT NULL DEFAULT 'open',
    "snoozed_until" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_reason" TEXT,
    "reopened_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_flags_organization_id_state_idx" ON "review_flags"("organization_id", "state");

-- CreateIndex
CREATE INDEX "review_flags_client_id_rule_key_state_idx" ON "review_flags"("client_id", "rule_key", "state");

-- CreateIndex
CREATE UNIQUE INDEX "review_flags_organization_id_dedupe_key_key" ON "review_flags"("organization_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A resolved or dismissed flag records who/when (null resolver = automatic) and why; a snooze has its date.
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_state_check" CHECK (
  ("state" IN ('resolved', 'dismissed')) = ("resolved_at" IS NOT NULL)
  AND ("state" <> 'snoozed' OR "snoozed_until" IS NOT NULL)
  AND ("resolution_reason" IS NULL OR char_length("resolution_reason") BETWEEN 1 AND 500)
);
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_severity_check" CHECK ("severity" = 'needs_review');

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "review_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_flags" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "review_flags" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
