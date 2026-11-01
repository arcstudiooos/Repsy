-- D-011 #5: uploaded files in private storage, streamed only to the people allowed to see them. Progress photos
-- (PRD E3, E4), message attachments (H2), form-check videos (D10) and custom exercise demos (C2). Images are stored
-- with their metadata stripped. Erasure marks a client's files (erased_at); a worker job deletes the objects.
CREATE TABLE "media_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erased_at" TIMESTAMPTZ(3),
    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_files_storage_key_key" ON "media_files"("storage_key");
CREATE UNIQUE INDEX "media_files_id_organization_id_key" ON "media_files"("id", "organization_id");
CREATE INDEX "media_files_organization_id_client_id_idx" ON "media_files"("organization_id", "client_id");
CREATE INDEX "media_files_erased_at_idx" ON "media_files"("erased_at") WHERE "erased_at" IS NOT NULL;
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_check" CHECK (
  "purpose" IN ('progress_photo', 'message', 'form_check', 'exercise_demo')
  AND ("purpose" = 'exercise_demo') = ("client_id" IS NULL)
  AND "content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4')
  AND "bytes" BETWEEN 1 AND 104857600
);

CREATE TABLE "progress_photos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "pose" TEXT NOT NULL,
    "taken_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "progress_photos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "progress_photos_media_id_key" ON "progress_photos"("media_id");
CREATE UNIQUE INDEX "progress_photos_media_id_organization_id_key" ON "progress_photos"("media_id", "organization_id");
CREATE INDEX "progress_photos_organization_id_client_id_taken_on_idx" ON "progress_photos"("organization_id", "client_id", "taken_on");
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_media_id_organization_id_fkey" FOREIGN KEY ("media_id", "organization_id") REFERENCES "media_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_pose_check" CHECK ("pose" IN ('front', 'side', 'back'));

CREATE TABLE "session_media" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "workout_version_exercise_id" UUID,
    "media_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_media_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "session_media_media_id_key" ON "session_media"("media_id");
CREATE UNIQUE INDEX "session_media_media_id_organization_id_key" ON "session_media"("media_id", "organization_id");
CREATE INDEX "session_media_session_id_idx" ON "session_media"("session_id");
CREATE INDEX "session_media_organization_id_idx" ON "session_media"("organization_id");
ALTER TABLE "session_media" ADD CONSTRAINT "session_media_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "workout_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_media" ADD CONSTRAINT "session_media_workout_version_exercise_id_organization_id_fkey" FOREIGN KEY ("workout_version_exercise_id", "organization_id") REFERENCES "workout_version_exercises"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_media" ADD CONSTRAINT "session_media_media_id_organization_id_fkey" FOREIGN KEY ("media_id", "organization_id") REFERENCES "media_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages" ADD COLUMN "attachment_media_id" UUID;
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_media_id_organization_id_fkey" FOREIGN KEY ("attachment_media_id", "organization_id") REFERENCES "media_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exercises" ADD COLUMN "demo_media_id" UUID;
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_demo_media_id_fkey" FOREIGN KEY ("demo_media_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "media_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "media_files" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
ALTER TABLE "progress_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "progress_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "progress_photos" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
ALTER TABLE "session_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_media" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "session_media" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
