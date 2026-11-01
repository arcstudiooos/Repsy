-- PRD A6: workspace branding shown to clients. Contrast is checked in core; the format here.
ALTER TABLE "organizations" ADD COLUMN "brand_accent" TEXT,
ADD COLUMN "logo_url" TEXT;
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_brand_accent_check" CHECK ("brand_accent" IS NULL OR "brand_accent" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "organizations_logo_url_check" CHECK ("logo_url" IS NULL OR ("logo_url" ~ '^https://' AND char_length("logo_url") <= 500));
