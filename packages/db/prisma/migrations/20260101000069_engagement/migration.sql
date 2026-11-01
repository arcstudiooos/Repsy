-- PRD I4: the engagement signal. A client's portal visits are kept as one row per local day (nothing about what they
-- looked at), and an opt-in review rule raises "Needs review" when the weekly score drops.
CREATE TABLE "portal_visits" (
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    CONSTRAINT "portal_visits_pkey" PRIMARY KEY ("client_id", "local_date")
);
CREATE INDEX "portal_visits_organization_id_idx" ON "portal_visits"("organization_id");
ALTER TABLE "portal_visits" ADD CONSTRAINT "portal_visits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portal_visits" ADD CONSTRAINT "portal_visits_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portal_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_visits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_visits" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TYPE "review_rule" ADD VALUE 'engagement_drop';
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_review_rules_check";
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_review_rules_check"
    CHECK ("review_rules" <@ ARRAY['habit_low', 'program_ending', 'reply_overdue', 'weight_change', 'nutrition_low', 'engagement_drop']::TEXT[]);
