-- PRD G4: lessons and courses. A course's lessons unlock one a day or one a week from the client's start date; the
-- client marks each done and the coach sees how far they are.
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cadence" TEXT NOT NULL DEFAULT 'weekly',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "courses_id_organization_id_key" ON "courses"("id", "organization_id");
CREATE INDEX "courses_organization_id_idx" ON "courses"("organization_id");
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("description") <= 2000 AND "cadence" IN ('daily', 'weekly')
);

CREATE TABLE "course_lessons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "course_lessons_id_organization_id_key" ON "course_lessons"("id", "organization_id");
CREATE INDEX "course_lessons_course_id_idx" ON "course_lessons"("course_id");
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "courses"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("body") <= 20000
  AND ("url" IS NULL OR ("url" LIKE 'https://%' AND length("url") <= 500))
);

CREATE TABLE "course_enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "start_local_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "course_enrollments_id_organization_id_key" ON "course_enrollments"("id", "organization_id");
CREATE UNIQUE INDEX "course_enrollments_one_open" ON "course_enrollments"("course_id", "client_id") WHERE "ended_at" IS NULL;
CREATE INDEX "course_enrollments_organization_id_client_id_idx" ON "course_enrollments"("organization_id", "client_id");
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "courses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lesson_completions" (
    "enrollment_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lesson_completions_pkey" PRIMARY KEY ("enrollment_id", "lesson_id")
);
CREATE INDEX "lesson_completions_organization_id_idx" ON "lesson_completions"("organization_id");
ALTER TABLE "lesson_completions" ADD CONSTRAINT "lesson_completions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lesson_completions" ADD CONSTRAINT "lesson_completions_enrollment_id_organization_id_fkey" FOREIGN KEY ("enrollment_id", "organization_id") REFERENCES "course_enrollments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_completions" ADD CONSTRAINT "lesson_completions_lesson_id_organization_id_fkey" FOREIGN KEY ("lesson_id", "organization_id") REFERENCES "course_lessons"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['courses', 'course_lessons', 'course_enrollments', 'lesson_completions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;

ALTER TABLE "sequence_steps" DROP CONSTRAINT "sequence_steps_check";
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_check" CHECK (
  "day_offset" BETWEEN 0 AND 365 AND "local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND "type" IN ('message', 'form', 'habit', 'tag_add', 'tag_remove', 'program', 'followup', 'course')
);
