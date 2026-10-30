-- D-008 schema fix: a child row and the parent it references must belong to the same organization.
-- Each parent gets UNIQUE (id, organization_id); each single-column parent FK is replaced by a composite
-- (child_fk, organization_id) FK onto it, so a cross-tenant link fails even from system scope (RLS bypassed).
--
-- DDL only: no row is updated or deleted, so the immutability triggers on workout_versions,
-- workout_version_exercises, program_versions and program_slots (migration 000014) are not involved.
-- Composite FKs use MATCH SIMPLE: programs.client_id stays nullable (templates), and a NULL skips the check.
-- programs -> clients becomes ON DELETE RESTRICT (was SET NULL, which would now also null organization_id);
-- client deletion is a future, explicit workflow (D-008 #16) that handles client copies first.

-- DropForeignKey
ALTER TABLE "client_invites" DROP CONSTRAINT "client_invites_client_id_fkey";

-- DropForeignKey
ALTER TABLE "program_assignments" DROP CONSTRAINT "program_assignments_client_id_fkey";

-- DropForeignKey
ALTER TABLE "program_assignments" DROP CONSTRAINT "program_assignments_program_id_fkey";

-- DropForeignKey
ALTER TABLE "program_slots" DROP CONSTRAINT "program_slots_program_version_id_fkey";

-- DropForeignKey
ALTER TABLE "program_slots" DROP CONSTRAINT "program_slots_workout_version_id_fkey";

-- DropForeignKey
ALTER TABLE "program_versions" DROP CONSTRAINT "program_versions_program_id_fkey";

-- DropForeignKey
ALTER TABLE "programs" DROP CONSTRAINT "programs_client_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_sessions" DROP CONSTRAINT "workout_sessions_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_sessions" DROP CONSTRAINT "workout_sessions_client_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_version_exercises" DROP CONSTRAINT "workout_version_exercises_workout_version_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "clients_id_organization_id_key" ON "clients"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_assignments_id_organization_id_key" ON "program_assignments"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_versions_id_organization_id_key" ON "program_versions"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_id_organization_id_key" ON "programs"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_versions_id_organization_id_key" ON "workout_versions"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "client_invites" ADD CONSTRAINT "client_invites_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_versions" ADD CONSTRAINT "program_versions_program_id_organization_id_fkey" FOREIGN KEY ("program_id", "organization_id") REFERENCES "programs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_slots" ADD CONSTRAINT "program_slots_program_version_id_organization_id_fkey" FOREIGN KEY ("program_version_id", "organization_id") REFERENCES "program_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_slots" ADD CONSTRAINT "program_slots_workout_version_id_organization_id_fkey" FOREIGN KEY ("workout_version_id", "organization_id") REFERENCES "workout_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_version_exercises" ADD CONSTRAINT "workout_version_exercises_workout_version_id_organization__fkey" FOREIGN KEY ("workout_version_id", "organization_id") REFERENCES "workout_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_program_id_organization_id_fkey" FOREIGN KEY ("program_id", "organization_id") REFERENCES "programs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_assignment_id_organization_id_fkey" FOREIGN KEY ("assignment_id", "organization_id") REFERENCES "program_assignments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

