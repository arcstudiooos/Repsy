-- PRD C3: richer exercise attributes. Catalog rows keep the defaults (globals are read-only).
ALTER TABLE "exercises" ADD COLUMN "cues" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "difficulty" TEXT,
ADD COLUMN "secondary_muscles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "unilateral" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "exercises"
  ADD CONSTRAINT "exercises_difficulty_check" CHECK ("difficulty" IS NULL OR "difficulty" IN ('beginner', 'intermediate', 'advanced')),
  ADD CONSTRAINT "exercises_cues_check" CHECK (cardinality("cues") <= 6),
  ADD CONSTRAINT "exercises_secondary_muscles_check" CHECK (cardinality("secondary_muscles") <= 5);
