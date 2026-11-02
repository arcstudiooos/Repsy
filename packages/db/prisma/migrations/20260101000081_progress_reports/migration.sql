-- PRD E10: a monthly progress report for the client. The row holds the coach's summary and choices; the PDF is built
-- from the client's data each time it is opened, so it never goes stale or holds a copy of their photos.
CREATE TABLE "progress_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "include_photos" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "progress_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "progress_reports_client_id_month_key" ON "progress_reports"("client_id", "month");
CREATE INDEX "progress_reports_organization_id_client_id_idx" ON "progress_reports"("organization_id", "client_id");
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_check" CHECK (
  extract(day FROM "month") = 1 AND length("summary") <= 4000
);
ALTER TABLE "progress_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "progress_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "progress_reports" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
