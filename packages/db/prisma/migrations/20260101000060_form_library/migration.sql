-- PRD F2: many templates per workspace, in three kinds: recurring check-in, one-off form, intake (PRD B12).
-- The workspace's default check-in template (the one every organization starts with) stays unique, now through a
-- partial index instead of the unique organization_id, so the first-read race still creates one row.
DROP INDEX "checkin_templates_organization_id_key";
ALTER TABLE "checkin_templates" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'checkin';
ALTER TABLE "checkin_templates" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "checkin_templates" ADD COLUMN "archived_at" TIMESTAMPTZ(3);
UPDATE "checkin_templates" SET "is_default" = true;
ALTER TABLE "checkin_templates" ADD CONSTRAINT "checkin_templates_kind_check"
  CHECK ("kind" IN ('checkin', 'form', 'intake'));
ALTER TABLE "checkin_templates" ADD CONSTRAINT "checkin_templates_default_check"
  CHECK (NOT "is_default" OR ("kind" = 'checkin' AND "archived_at" IS NULL));
CREATE UNIQUE INDEX "checkin_templates_one_default_per_org" ON "checkin_templates"("organization_id") WHERE "is_default";
CREATE INDEX "checkin_templates_organization_id_kind_idx" ON "checkin_templates"("organization_id", "kind");

-- A check-in is a recurring one, a one-off form or an intake form. One recurring check-in per client per day, as
-- before; forms are not limited by date.
ALTER TABLE "checkins" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'checkin';
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_kind_check" CHECK ("kind" IN ('checkin', 'form', 'intake'));
DROP INDEX "checkins_client_id_period_local_date_key";
CREATE UNIQUE INDEX "checkins_one_checkin_per_client_day" ON "checkins"("client_id", "period_local_date") WHERE "kind" = 'checkin';
CREATE INDEX "checkins_client_id_period_local_date_idx" ON "checkins"("client_id", "period_local_date");
