-- PRD D14: clients may move a workout within its week when the workspace allows it; the coach gets a review item.
ALTER TYPE "review_rule" ADD VALUE 'workout_moved';
ALTER TABLE "organizations" ADD COLUMN "clients_can_move_workouts" BOOLEAN NOT NULL DEFAULT false;
