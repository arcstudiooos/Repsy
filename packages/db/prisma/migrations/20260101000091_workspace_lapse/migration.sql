-- PRD M12 (D-013 #16): a platform admin can mark a workspace lapsed (an ended trial lapses it too). A lapsed
-- workspace is read-only; clients keep read access for 90 days and staff for 180 from the lapse.
ALTER TABLE "organizations" ADD COLUMN "lapsed_at" TIMESTAMPTZ(3);
