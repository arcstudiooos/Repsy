-- PRD B13: where a client trains and the kit they have; the builder warns about exercises outside it.
ALTER TABLE "clients" ADD COLUMN "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "training_location" TEXT;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_training_location_check"
    CHECK ("training_location" IS NULL OR "training_location" IN ('home', 'commercial_gym', 'outdoors', 'other')),
  ADD CONSTRAINT "clients_equipment_check"
    CHECK ("equipment" <@ ARRAY['Barbell', 'Dumbbell', 'Kettlebell', 'Machine', 'Cable', 'Band', 'Bodyweight', 'Cardio machine', 'Other']::TEXT[]);
