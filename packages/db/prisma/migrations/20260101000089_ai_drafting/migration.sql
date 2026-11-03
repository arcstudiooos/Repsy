-- PRD I10-I12, I14 (D-013 #14): AI drafting, off until the owner turns it on. Each request is logged without any
-- content (who, which kind, sizes, how many lines the safety filter removed, the outcome); the log also enforces the
-- workspace's daily cap.
ALTER TABLE "organizations" ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input_chars" INTEGER NOT NULL DEFAULT 0,
    "output_chars" INTEGER NOT NULL DEFAULT 0,
    "removed_lines" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_requests_organization_id_created_at_idx" ON "ai_requests"("organization_id", "created_at");
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_check" CHECK (
  "kind" IN ('program_from_text', 'program_from_template', 'checkin_highlights')
  AND "status" IN ('pending', 'ok', 'refused', 'error')
  AND "input_chars" >= 0 AND "output_chars" >= 0 AND "removed_lines" >= 0
);

ALTER TABLE "ai_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_requests" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
