-- PRD A5: a coach can hide the dashboard setup checklist.
ALTER TABLE "coach_profiles" ADD COLUMN "setup_dismissed_at" TIMESTAMPTZ(3);
