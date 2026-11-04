-- PRD M12: a lapse can end (the workspace subscribes again). Access checks read only open lapses
-- (resolved_at IS NULL); resolved rows stay as history.
ALTER TABLE "subscription_lapses" ADD COLUMN "resolved_at" TIMESTAMPTZ(3);
