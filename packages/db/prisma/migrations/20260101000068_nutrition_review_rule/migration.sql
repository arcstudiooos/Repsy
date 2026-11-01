-- PRD G13: an opt-in review rule for nutrition adherence under 50% in each of the last two full weeks.
ALTER TYPE "review_rule" ADD VALUE 'nutrition_low';

ALTER TABLE "organizations" DROP CONSTRAINT "organizations_review_rules_check";
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_review_rules_check"
    CHECK ("review_rules" <@ ARRAY['habit_low', 'program_ending', 'reply_overdue', 'weight_change', 'nutrition_low']::TEXT[]);
