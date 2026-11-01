-- PRD A4 (D-011 #4): a sign-up without a pilot code gets a 14-day trial for up to 3 active clients.
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" TIMESTAMPTZ(3);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_trial_check"
  CHECK (("plan" = 'trial') = ("trial_ends_at" IS NOT NULL));
