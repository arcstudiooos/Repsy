-- PRD C8: blocks. An exercise joins the block above it (group_with_previous) or starts one; the first exercise of a
-- block may carry its format and settings (block_json: superset, circuit, interval, amrap, emom, for_time; validated
-- in packages/core/src/programs/blocks.ts). Labels such as A1 and A2 are derived, never stored.
ALTER TABLE "workout_version_exercises" ADD COLUMN "group_with_previous" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workout_version_exercises" ADD COLUMN "block_json" JSONB;
ALTER TABLE "workout_version_exercises" ADD CONSTRAINT "workout_version_exercises_group_check"
  CHECK (NOT "group_with_previous" OR "position" > 0);
ALTER TABLE "workout_version_exercises" ADD CONSTRAINT "workout_version_exercises_block_check"
  CHECK ("block_json" IS NULL OR (jsonb_typeof("block_json") = 'object' AND NOT "group_with_previous"));
