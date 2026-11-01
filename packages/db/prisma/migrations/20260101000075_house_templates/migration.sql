-- PRD C20: the shared program library. An owner or admin publishes a template as a house template: every coach on the
-- team sees and assigns it, only owners and admins edit it, and coaches duplicate it to make their own.
ALTER TABLE "programs" ADD COLUMN "house" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "programs" ADD CONSTRAINT "programs_house_check" CHECK (NOT "house" OR "kind" = 'template');
