-- PRD B18/E9: client goals tracked from recorded data. Composite tenant FKs; forced RLS.

-- CreateEnum
CREATE TYPE "goal_kind" AS ENUM ('metric', 'exercise', 'habit');

-- CreateEnum
CREATE TYPE "goal_status" AS ENUM ('active', 'archived');

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "kind" "goal_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "metric" "body_metric",
    "exercise_id" UUID,
    "exercise_measure" TEXT,
    "habit_id" UUID,
    "start_value" DECIMAL(12,3) NOT NULL,
    "target_value" DECIMAL(12,3) NOT NULL,
    "start_date" DATE NOT NULL,
    "target_date" DATE NOT NULL,
    "status" "goal_status" NOT NULL DEFAULT 'active',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_client_id_status_idx" ON "goals"("client_id", "status");

-- CreateIndex
CREATE INDEX "goals_organization_id_idx" ON "goals"("organization_id");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_habit_id_organization_id_fkey" FOREIGN KEY ("habit_id", "organization_id") REFERENCES "habits"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "goals" ADD CONSTRAINT "goals_title_check" CHECK (char_length("title") BETWEEN 1 AND 120);
ALTER TABLE "goals" ADD CONSTRAINT "goals_dates_check" CHECK ("target_date" > "start_date");
-- Exactly the subject fields of its kind are set.
ALTER TABLE "goals" ADD CONSTRAINT "goals_kind_check" CHECK (
  ("kind" = 'metric' AND "metric" IS NOT NULL AND "exercise_id" IS NULL AND "exercise_measure" IS NULL AND "habit_id" IS NULL)
  OR ("kind" = 'exercise' AND "metric" IS NULL AND "exercise_id" IS NOT NULL AND "exercise_measure" IN ('e1rm', 'heaviest') AND "habit_id" IS NULL)
  OR ("kind" = 'habit' AND "metric" IS NULL AND "exercise_id" IS NULL AND "exercise_measure" IS NULL AND "habit_id" IS NOT NULL)
);

ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goals" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
