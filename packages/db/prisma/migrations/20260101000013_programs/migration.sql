-- CreateEnum
CREATE TYPE "program_kind" AS ENUM ('template', 'client');

-- CreateEnum
CREATE TYPE "program_status" AS ENUM ('active', 'archived');

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "program_kind" NOT NULL DEFAULT 'template',
    "client_id" UUID,
    "source_program_id" UUID,
    "source_version_id" UUID,
    "current_version_id" UUID,
    "status" "program_status" NOT NULL DEFAULT 'active',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "committed_by" UUID NOT NULL,
    "committed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "days_per_week" INTEGER NOT NULL,
    "week_count" INTEGER NOT NULL,

    CONSTRAINT "program_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_slots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_version_id" UUID NOT NULL,
    "week_index" INTEGER NOT NULL,
    "day_index" INTEGER NOT NULL,
    "workout_version_id" UUID NOT NULL,

    CONSTRAINT "program_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_version_exercises" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workout_version_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "target_json" JSONB NOT NULL,
    "note" TEXT,

    CONSTRAINT "workout_version_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "programs_current_version_id_key" ON "programs"("current_version_id");

-- CreateIndex
CREATE INDEX "programs_organization_id_kind_status_created_at_id_idx" ON "programs"("organization_id", "kind", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "programs_organization_id_client_id_idx" ON "programs"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "program_versions_organization_id_idx" ON "program_versions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_versions_program_id_version_no_key" ON "program_versions"("program_id", "version_no");

-- CreateIndex
CREATE INDEX "program_slots_organization_id_idx" ON "program_slots"("organization_id");

-- CreateIndex
CREATE INDEX "program_slots_workout_version_id_idx" ON "program_slots"("workout_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_slots_program_version_id_week_index_day_index_key" ON "program_slots"("program_version_id", "week_index", "day_index");

-- CreateIndex
CREATE INDEX "workout_versions_organization_id_content_hash_idx" ON "workout_versions"("organization_id", "content_hash");

-- CreateIndex
CREATE INDEX "workout_version_exercises_organization_id_idx" ON "workout_version_exercises"("organization_id");

-- CreateIndex
CREATE INDEX "workout_version_exercises_exercise_id_idx" ON "workout_version_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_version_exercises_workout_version_id_position_key" ON "workout_version_exercises"("workout_version_id", "position");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_program_id_fkey" FOREIGN KEY ("source_program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "program_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "program_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_versions" ADD CONSTRAINT "program_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_versions" ADD CONSTRAINT "program_versions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_versions" ADD CONSTRAINT "program_versions_committed_by_fkey" FOREIGN KEY ("committed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_slots" ADD CONSTRAINT "program_slots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_slots" ADD CONSTRAINT "program_slots_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_slots" ADD CONSTRAINT "program_slots_workout_version_id_fkey" FOREIGN KEY ("workout_version_id") REFERENCES "workout_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_versions" ADD CONSTRAINT "workout_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_version_exercises" ADD CONSTRAINT "workout_version_exercises_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_version_exercises" ADD CONSTRAINT "workout_version_exercises_workout_version_id_fkey" FOREIGN KEY ("workout_version_id") REFERENCES "workout_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_version_exercises" ADD CONSTRAINT "workout_version_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-Level Security: tenant isolation on all five tables via the schema-safe helper functions.
ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "programs" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "program_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "program_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "program_versions" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "program_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "program_slots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "program_slots" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "workout_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workout_versions" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "workout_version_exercises" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout_version_exercises" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workout_version_exercises" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
