-- PRD F14: a coach marks a submitted check-in reviewed; the client sees when. Only a submitted check-in can be reviewed.

-- AlterTable
ALTER TABLE "checkins" ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_user_id" UUID;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "checkins" ADD CONSTRAINT "checkins_reviewed_after_submit_check" CHECK (
  "reviewed_at" IS NULL OR "submitted_at" IS NOT NULL
);
