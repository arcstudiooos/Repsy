-- Outbox rows carry their own retry state: claim lease and next attempt time.
ALTER TYPE "outbox_status" ADD VALUE 'sending';

ALTER TABLE "outbox_emails"
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lease_until" TIMESTAMPTZ(3);

CREATE INDEX "outbox_emails_status_next_attempt_at_idx" ON "outbox_emails"("status", "next_attempt_at");
