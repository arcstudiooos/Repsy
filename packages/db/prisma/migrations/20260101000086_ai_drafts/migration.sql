-- PRD I10, I11, I12, I14: AI drafting. Coach-only, per-workspace opt-in (off by default), output is
-- always a draft labelled "Drafted with AI". ai_settings holds the opt-in; ai_drafts holds drafts that
-- a coach explicitly saves later as a program (nothing here is a program, an assignment, or a send).
-- source_text stores ONLY the redacted paste (emails, phones and supplied client names stripped by
-- core); the provider never receives source text, notes, or check-in answers. The only shipped
-- provider is the fake/local one, so no provider key or network call is involved.
CREATE TABLE "ai_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'fake',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_settings_id_organization_id_key" ON "ai_settings"("id", "organization_id");
CREATE UNIQUE INDEX "ai_settings_organization_id_key" ON "ai_settings"("organization_id");
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_check" CHECK ("provider" = 'fake');

CREATE TABLE "ai_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "coach_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_text" TEXT,
    "draft_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_drafts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_drafts_id_organization_id_key" ON "ai_drafts"("id", "organization_id");
CREATE INDEX "ai_drafts_organization_id_idx" ON "ai_drafts"("organization_id");
CREATE INDEX "ai_drafts_organization_id_coach_user_id_idx" ON "ai_drafts"("organization_id", "coach_user_id");
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_check" CHECK (
  "kind" IN ('paste', 'template') AND "status" = 'draft'
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_settings', 'ai_drafts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
