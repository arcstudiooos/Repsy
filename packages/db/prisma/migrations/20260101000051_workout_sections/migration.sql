-- PRD C9: each exercise in a workout sits in a section (warm-up, main, conditioning, cool-down). Existing rows are main.
ALTER TABLE "workout_version_exercises" ADD COLUMN "section" TEXT NOT NULL DEFAULT 'main';
ALTER TABLE "workout_version_exercises" ADD CONSTRAINT "workout_version_exercises_section_check"
  CHECK ("section" IN ('warmup', 'main', 'conditioning', 'cooldown'));
