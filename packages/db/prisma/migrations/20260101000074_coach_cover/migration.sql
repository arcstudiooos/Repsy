-- PRD A13: cover and holiday mode. For a date range, one coach's clients appear in another coach's "My clients" and
-- review queue, client messages notify the covering coach, and the client sees who is covering. Nothing moves: the
-- primary coach (A11) stays, and the cover ends on its own.
CREATE TABLE "coach_covers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "coach_user_id" UUID NOT NULL,
    "cover_user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    CONSTRAINT "coach_covers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coach_covers_organization_id_cover_user_id_idx" ON "coach_covers"("organization_id", "cover_user_id");
CREATE INDEX "coach_covers_organization_id_coach_user_id_idx" ON "coach_covers"("organization_id", "coach_user_id");
ALTER TABLE "coach_covers" ADD CONSTRAINT "coach_covers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_covers" ADD CONSTRAINT "coach_covers_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_covers" ADD CONSTRAINT "coach_covers_cover_user_id_fkey" FOREIGN KEY ("cover_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_covers" ADD CONSTRAINT "coach_covers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_covers" ADD CONSTRAINT "coach_covers_check" CHECK (
  "coach_user_id" <> "cover_user_id" AND "ends_at" > "starts_at"
);

ALTER TABLE "coach_covers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coach_covers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "coach_covers" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
