-- PRD H14: coaches can opt in to a daily digest email. Off by default.
ALTER TABLE "notification_preferences" ADD COLUMN "digest_email_opt_in" BOOLEAN NOT NULL DEFAULT false;
