-- S2-4: the coach's "new completed workouts" marker (D-009 Sprint 2 review scope). Read queries over workout_sessions
-- compare completed_at with it; ReviewFlag rows replace this list in S4-2. memberships already has forced RLS.

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "review_seen_at" TIMESTAMPTZ(3);


-- CreateIndex: "new completed workouts" filters and sorts on completed_at.
CREATE INDEX "workout_sessions_organization_id_state_completed_at_idx" ON "workout_sessions"("organization_id", "state", "completed_at");
