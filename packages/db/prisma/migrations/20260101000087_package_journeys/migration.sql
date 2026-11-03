-- PRD J4, J6 (D-013 #13): sequences start when a package is bought, when its renewal or end is near, and when it
-- ends; a purchase remembers which renewal date it was last notified for, so each period notifies once.
ALTER TABLE "sequences" DROP CONSTRAINT "sequences_check";
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_check" CHECK (
  length("name") BETWEEN 1 AND 120
  AND "trigger" IN ('manual', 'invite_accepted', 'intake_submitted', 'checkin_submitted', 'program_finished', 'tag_added', 'stage_changed', 'package_purchased', 'package_renewal_due', 'package_ended')
);

ALTER TABLE "purchases" ADD COLUMN "renewal_notified_for" TIMESTAMPTZ(3);
