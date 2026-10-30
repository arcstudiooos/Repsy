-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('active', 'ended', 'completed');

-- CreateEnum
CREATE TYPE "session_state" AS ENUM ('scheduled', 'in_progress', 'completed', 'skipped', 'missed', 'incomplete', 'cancelled');

-- CreateTable
CREATE TABLE "program_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "start_local_date" DATE NOT NULL,
    "weekdays" INTEGER[],
    "timezone" TEXT NOT NULL,
    "status" "assignment_status" NOT NULL DEFAULT 'active',
    "readiness_confirmed_at" TIMESTAMPTZ(3),
    "readiness_confirmed_by" UUID,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "slot_week_index" INTEGER NOT NULL,
    "slot_day_index" INTEGER NOT NULL,
    "scheduled_local_date" DATE NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "state" "session_state" NOT NULL DEFAULT 'scheduled',
    "workout_version_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "comment" TEXT,
    "logged_by_user_id" UUID,
    "pause_offset_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_assignments_organization_id_idx" ON "program_assignments"("organization_id");

-- CreateIndex
CREATE INDEX "program_assignments_client_id_idx" ON "program_assignments"("client_id");

-- CreateIndex
CREATE INDEX "program_assignments_program_id_idx" ON "program_assignments"("program_id");

-- CreateIndex
CREATE INDEX "workout_sessions_organization_id_client_id_due_at_idx" ON "workout_sessions"("organization_id", "client_id", "due_at");

-- CreateIndex
CREATE INDEX "workout_sessions_assignment_id_idx" ON "workout_sessions"("assignment_id");

-- CreateIndex
CREATE INDEX "workout_sessions_workout_version_id_idx" ON "workout_sessions"("workout_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_sessions_assignment_id_slot_week_index_slot_day_ind_key" ON "workout_sessions"("assignment_id", "slot_week_index", "slot_day_index");

-- AddForeignKey
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_readiness_confirmed_by_fkey" FOREIGN KEY ("readiness_confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "program_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_version_id_fkey" FOREIGN KEY ("workout_version_id") REFERENCES "workout_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_logged_by_user_id_fkey" FOREIGN KEY ("logged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One active assignment per client (D-010 #2). Prisma cannot model partial indexes; this is the concurrency backstop
-- behind the client row lock taken by assignProgram.
CREATE UNIQUE INDEX "program_assignments_one_active_per_client" ON "program_assignments"("client_id") WHERE "status" = 'active';

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "program_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "program_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "program_assignments" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "workout_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workout_sessions" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
