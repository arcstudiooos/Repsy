-- Roadmap cuts (2026-11-06): custom domains (PRD L4) and AI drafting (I10-I12, I14) are removed.
-- Both were off in production (custom domains behind FEATURE_CUSTOM_DOMAINS, AI drafting opt-in with a
-- fake provider), so these tables hold no customer data worth keeping.
DROP TABLE IF EXISTS "custom_domains";
DROP TABLE IF EXISTS "ai_drafts";

-- ai_settings now holds the opt-in for the AI assistant, which sends workspace data to Anthropic.
-- An opt-in given for the old fake drafting is not consent for that, so every workspace starts OFF.
ALTER TABLE "ai_settings" DROP CONSTRAINT IF EXISTS "ai_settings_check";
UPDATE "ai_settings" SET "provider" = 'anthropic', "ai_enabled" = false;
ALTER TABLE "ai_settings" ALTER COLUMN "provider" SET DEFAULT 'anthropic';
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_check" CHECK ("provider" = 'anthropic');
