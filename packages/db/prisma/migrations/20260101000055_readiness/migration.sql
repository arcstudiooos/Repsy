-- PRD D17: an optional readiness check before Start. Five 1-5 answers (5 = best: slept well, full of energy, not sore,
-- calm, good mood) and their 0-100 score, kept on the session so erasure and export follow it.
ALTER TABLE "workout_sessions" ADD COLUMN "readiness_json" JSONB;
ALTER TABLE "workout_sessions" ADD COLUMN "readiness_score" SMALLINT;
ALTER TABLE "workout_sessions" ADD COLUMN "readiness_at" TIMESTAMPTZ(3);
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_readiness_check" CHECK (
  ("readiness_json" IS NULL AND "readiness_score" IS NULL AND "readiness_at" IS NULL)
  OR (jsonb_typeof("readiness_json") = 'object' AND "readiness_score" BETWEEN 0 AND 100 AND "readiness_at" IS NOT NULL)
);
