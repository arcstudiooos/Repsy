-- PRD I3: opt-in review rules.
ALTER TYPE "review_rule" ADD VALUE 'habit_low';
ALTER TYPE "review_rule" ADD VALUE 'program_ending';
ALTER TYPE "review_rule" ADD VALUE 'reply_overdue';
ALTER TYPE "review_rule" ADD VALUE 'weight_change';

ALTER TABLE "organizations" ADD COLUMN "review_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "weight_change_band_pct" INTEGER;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_review_rules_check"
    CHECK ("review_rules" <@ ARRAY['habit_low', 'program_ending', 'reply_overdue', 'weight_change']::TEXT[]),
  ADD CONSTRAINT "organizations_weight_change_band_pct_check"
    CHECK ("weight_change_band_pct" IS NULL OR "weight_change_band_pct" BETWEEN 1 AND 20);
