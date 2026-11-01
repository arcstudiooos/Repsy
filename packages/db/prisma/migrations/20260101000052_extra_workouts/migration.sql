-- PRD D13: extra workouts. A client logs an unplanned session, from a blank list of exercises or a workout the coach
-- shares. It sits in workout_sessions (so set logs, notes, swaps and history work unchanged) with kind 'extra': no
-- assignment and no slot, and its workout version is fixed from the start. Adherence counts planned sessions only.
ALTER TABLE "workout_sessions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'planned';
ALTER TABLE "workout_sessions" ALTER COLUMN "assignment_id" DROP NOT NULL;
ALTER TABLE "workout_sessions" ALTER COLUMN "slot_week_index" DROP NOT NULL;
ALTER TABLE "workout_sessions" ALTER COLUMN "slot_day_index" DROP NOT NULL;
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_kind_check" CHECK (
  ("kind" = 'planned' AND "assignment_id" IS NOT NULL AND "slot_week_index" IS NOT NULL AND "slot_day_index" IS NOT NULL)
  OR ("kind" = 'extra' AND "assignment_id" IS NULL AND "slot_week_index" IS NULL AND "slot_day_index" IS NULL
      AND "workout_version_id" IS NOT NULL)
);
CREATE INDEX "workout_sessions_organization_id_client_id_kind_idx" ON "workout_sessions"("organization_id", "client_id", "kind");

-- Templates the coach offers to clients as extra workouts.
ALTER TABLE "programs" ADD COLUMN "shared_with_clients" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "programs" ADD CONSTRAINT "programs_shared_template_check" CHECK (NOT "shared_with_clients" OR "kind" = 'template');
