-- S4-1 weekly check-ins (D-008 #9, D-010 #3). One template per organization (unique organization_id), seeded on
-- first use. A check-in keeps the questions it was issued with. Generation is idempotent on
-- (client_id, period_local_date). Tenant links are composite (fk, organization_id) FKs; clients.checkin_template_id
-- is MATCH SIMPLE (null until a weekday is set).


-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "checkin_template_id" UUID,
ADD COLUMN     "checkin_weekday" INTEGER;

-- CreateTable
CREATE TABLE "checkin_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "questions_json" JSONB NOT NULL,
    "is_seeded" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checkin_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "period_local_date" DATE NOT NULL,
    "questions_json" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "answers_json" JSONB,
    "draft_json" JSONB,
    "draft_updated_at" TIMESTAMPTZ(3),
    "submit_idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkin_templates_organization_id_key" ON "checkin_templates"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_templates_id_organization_id_key" ON "checkin_templates"("id", "organization_id");

-- CreateIndex
CREATE INDEX "checkins_organization_id_due_at_idx" ON "checkins"("organization_id", "due_at");

-- CreateIndex
CREATE INDEX "checkins_organization_id_submitted_at_idx" ON "checkins"("organization_id", "submitted_at");

-- CreateIndex
CREATE INDEX "checkins_template_id_idx" ON "checkins"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkins_client_id_period_local_date_key" ON "checkins"("client_id", "period_local_date");

-- CreateIndex
CREATE UNIQUE INDEX "checkins_id_organization_id_key" ON "checkins"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_checkin_template_id_organization_id_fkey" FOREIGN KEY ("checkin_template_id", "organization_id") REFERENCES "checkin_templates"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_templates" ADD CONSTRAINT "checkin_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_template_id_organization_id_fkey" FOREIGN KEY ("template_id", "organization_id") REFERENCES "checkin_templates"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ISO weekday.
ALTER TABLE "clients" ADD CONSTRAINT "clients_checkin_weekday_check" CHECK (
  "checkin_weekday" IS NULL OR "checkin_weekday" BETWEEN 1 AND 7
);

-- A submitted check-in has its answers and idempotency key; a draft only exists before submission.
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_submission_check" CHECK (
  ("submitted_at" IS NULL AND "answers_json" IS NULL AND "submit_idempotency_key" IS NULL)
  OR ("submitted_at" IS NOT NULL AND "answers_json" IS NOT NULL AND "submit_idempotency_key" IS NOT NULL
      AND "draft_json" IS NULL)
);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "checkin_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkin_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "checkin_templates" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "checkins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkins" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "checkins" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
