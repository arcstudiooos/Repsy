-- PRD F4: a client's check-in comes every week, every 2 weeks or every 4 weeks, on their check-in weekday.
ALTER TABLE "clients" ADD COLUMN "checkin_every_weeks" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "clients" ADD CONSTRAINT "clients_checkin_every_weeks_check" CHECK ("checkin_every_weeks" IN (1, 2, 4));
