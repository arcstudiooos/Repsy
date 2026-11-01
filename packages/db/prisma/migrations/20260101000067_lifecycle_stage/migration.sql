-- PRD B20: the coach's lifecycle stage for a client. Onboarding, Active and At renewal are stored here; Paused and
-- Alumni come from the client's status (an open pause, archived), so the stage never disagrees with it. A client's
-- first completed workout moves Onboarding to Active.
ALTER TABLE "clients" ADD COLUMN "lifecycle_stage" TEXT NOT NULL DEFAULT 'onboarding';
ALTER TABLE "clients" ADD CONSTRAINT "clients_lifecycle_stage_check"
  CHECK ("lifecycle_stage" IN ('onboarding', 'active', 'at_renewal'));

UPDATE "clients" c SET "lifecycle_stage" = 'active'
 WHERE EXISTS (SELECT 1 FROM "workout_sessions" s WHERE s."client_id" = c."id" AND s."state" = 'completed');
