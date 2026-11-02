-- PRD E5: assessment photos and retests. A coach defines an assessment (what to photograph, a guide overlay, how
-- often to retest); a client assigned it takes the photo when it is due, and the coach compares the first and latest.
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "guide" TEXT NOT NULL DEFAULT 'posture_grid',
    "every_weeks" INTEGER NOT NULL DEFAULT 4,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assessments_id_organization_id_key" ON "assessments"("id", "organization_id");
CREATE INDEX "assessments_organization_id_idx" ON "assessments"("organization_id");
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("instructions") <= 2000
  AND "guide" IN ('posture_grid', 'plumb_line', 'none') AND "every_weeks" BETWEEN 0 AND 52
);

CREATE TABLE "client_assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "start_local_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    CONSTRAINT "client_assessments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_assessments_id_organization_id_key" ON "client_assessments"("id", "organization_id");
CREATE UNIQUE INDEX "client_assessments_one_open" ON "client_assessments"("assessment_id", "client_id") WHERE "ended_at" IS NULL;
CREATE INDEX "client_assessments_organization_id_client_id_idx" ON "client_assessments"("organization_id", "client_id");
ALTER TABLE "client_assessments" ADD CONSTRAINT "client_assessments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_assessments" ADD CONSTRAINT "client_assessments_assessment_id_organization_id_fkey" FOREIGN KEY ("assessment_id", "organization_id") REFERENCES "assessments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_assessments" ADD CONSTRAINT "client_assessments_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "assessment_photos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_assessment_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "taken_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assessment_photos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assessment_photos_media_id_key" ON "assessment_photos"("media_id");
CREATE UNIQUE INDEX "assessment_photos_media_id_organization_id_key" ON "assessment_photos"("media_id", "organization_id");
CREATE INDEX "assessment_photos_client_assessment_id_taken_on_idx" ON "assessment_photos"("client_assessment_id", "taken_on");
CREATE INDEX "assessment_photos_organization_id_idx" ON "assessment_photos"("organization_id");
ALTER TABLE "assessment_photos" ADD CONSTRAINT "assessment_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_photos" ADD CONSTRAINT "assessment_photos_client_assessment_id_organization_id_fkey" FOREIGN KEY ("client_assessment_id", "organization_id") REFERENCES "client_assessments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_photos" ADD CONSTRAINT "assessment_photos_media_id_organization_id_fkey" FOREIGN KEY ("media_id", "organization_id") REFERENCES "media_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessments', 'client_assessments', 'assessment_photos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
