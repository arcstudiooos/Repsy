-- D-008 schema fix, second half (Sprint 1 follow-up "must land first in Sprint 2"): the last four single-column tenant
-- links become composite (fk, organization_id) FKs, the same way migration 000016 did the others, so a row can never
-- point at another organization's parent, even from system scope (RLS bypassed):
--   workout_sessions.workout_version_id (written when a session is started, Sprint 2),
--   programs.current_version_id, programs.source_program_id, programs.source_version_id.
-- MATCH SIMPLE: the columns stay nullable (unlocked sessions, templates, programs before their first commit) and a
-- NULL skips the check. ON DELETE RESTRICT, not SET NULL, which would also null organization_id.
-- DDL only: no row is updated or deleted, so the immutability triggers (migration 000014) are not involved.
--
-- Also adds the (organization_id, state, due_at) index for the portal "upcoming" reads and the S4 missed sweep.
-- DropForeignKey
ALTER TABLE "programs" DROP CONSTRAINT "programs_current_version_id_fkey";

-- DropForeignKey
ALTER TABLE "programs" DROP CONSTRAINT "programs_source_program_id_fkey";

-- DropForeignKey
ALTER TABLE "programs" DROP CONSTRAINT "programs_source_version_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_sessions" DROP CONSTRAINT "workout_sessions_workout_version_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "programs_current_version_id_organization_id_key" ON "programs"("current_version_id", "organization_id");

-- CreateIndex
CREATE INDEX "workout_sessions_organization_id_state_due_at_idx" ON "workout_sessions"("organization_id", "state", "due_at");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_program_id_organization_id_fkey" FOREIGN KEY ("source_program_id", "organization_id") REFERENCES "programs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_version_id_organization_id_fkey" FOREIGN KEY ("source_version_id", "organization_id") REFERENCES "program_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_current_version_id_organization_id_fkey" FOREIGN KEY ("current_version_id", "organization_id") REFERENCES "program_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_version_id_organization_id_fkey" FOREIGN KEY ("workout_version_id", "organization_id") REFERENCES "workout_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

