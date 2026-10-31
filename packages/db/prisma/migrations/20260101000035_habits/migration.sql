-- PRD G1-G3 habits and tasks: a coach assigns habits (repeating on N days a week) and one-off tasks to a client; the
-- client ticks them per client-local day. Composite (client_id, organization_id) FKs; forced RLS.

-- CreateEnum
CREATE TYPE "habit_status" AS ENUM ('active', 'archived');

-- CreateTable
CREATE TABLE "habits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "is_task" BOOLEAN NOT NULL DEFAULT false,
    "days_per_week" INTEGER,
    "target_count" INTEGER,
    "unit" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "due_date" DATE,
    "status" "habit_status" NOT NULL DEFAULT 'active',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "habit_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "habit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "habits_client_id_status_idx" ON "habits"("client_id", "status");

-- CreateIndex
CREATE INDEX "habits_organization_id_idx" ON "habits"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "habits_id_organization_id_key" ON "habits"("id", "organization_id");

-- CreateIndex
CREATE INDEX "habit_logs_client_id_local_date_idx" ON "habit_logs"("client_id", "local_date");

-- CreateIndex
CREATE INDEX "habit_logs_organization_id_idx" ON "habit_logs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "habit_logs_habit_id_local_date_key" ON "habit_logs"("habit_id", "local_date");

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_habit_id_organization_id_fkey" FOREIGN KEY ("habit_id", "organization_id") REFERENCES "habits"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "habits" ADD CONSTRAINT "habits_title_check" CHECK (char_length("title") BETWEEN 1 AND 120);
ALTER TABLE "habits" ADD CONSTRAINT "habits_unit_check" CHECK ("unit" IS NULL OR char_length("unit") BETWEEN 1 AND 20);
ALTER TABLE "habits" ADD CONSTRAINT "habits_target_check" CHECK ("target_count" IS NULL OR "target_count" BETWEEN 1 AND 100000);
-- A habit has days per week and no due date; a task has a due date and no days per week.
ALTER TABLE "habits" ADD CONSTRAINT "habits_kind_check" CHECK (
  ("is_task" = false AND "days_per_week" BETWEEN 1 AND 7 AND "due_date" IS NULL)
  OR ("is_task" = true AND "days_per_week" IS NULL AND "due_date" IS NOT NULL)
);
ALTER TABLE "habits" ADD CONSTRAINT "habits_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_value_check" CHECK ("value" BETWEEN 1 AND 100000);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "habits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "habits" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "habit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "habit_logs" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
