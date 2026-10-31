-- PRD C4 exercise alternatives and D8 swaps in the logger. Forced RLS on both.

-- CreateTable
CREATE TABLE "exercise_alternatives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "alternative_exercise_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_alternatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_exercise_swaps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "workout_version_exercise_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "swapped_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_exercise_swaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercise_alternatives_organization_id_exercise_id_position_idx" ON "exercise_alternatives"("organization_id", "exercise_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_alternatives_organization_id_exercise_id_alternati_key" ON "exercise_alternatives"("organization_id", "exercise_id", "alternative_exercise_id");

-- CreateIndex
CREATE INDEX "session_exercise_swaps_organization_id_idx" ON "session_exercise_swaps"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_exercise_swaps_session_id_workout_version_exercise__key" ON "session_exercise_swaps"("session_id", "workout_version_exercise_id");

-- AddForeignKey
ALTER TABLE "exercise_alternatives" ADD CONSTRAINT "exercise_alternatives_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_alternatives" ADD CONSTRAINT "exercise_alternatives_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_alternatives" ADD CONSTRAINT "exercise_alternatives_alternative_exercise_id_fkey" FOREIGN KEY ("alternative_exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exercise_swaps" ADD CONSTRAINT "session_exercise_swaps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exercise_swaps" ADD CONSTRAINT "session_exercise_swaps_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "workout_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exercise_swaps" ADD CONSTRAINT "session_exercise_swaps_workout_version_exercise_id_organiz_fkey" FOREIGN KEY ("workout_version_exercise_id", "organization_id") REFERENCES "workout_version_exercises"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exercise_swaps" ADD CONSTRAINT "session_exercise_swaps_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "exercise_alternatives" ADD CONSTRAINT "exercise_alternatives_not_self_check" CHECK ("exercise_id" <> "alternative_exercise_id");
ALTER TABLE "exercise_alternatives" ADD CONSTRAINT "exercise_alternatives_position_check" CHECK ("position" BETWEEN 0 AND 9);
ALTER TABLE "session_exercise_swaps" ADD CONSTRAINT "session_exercise_swaps_reason_check"
  CHECK ("reason" IN ('no_equipment', 'equipment_busy', 'preference', 'other'));

ALTER TABLE "exercise_alternatives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exercise_alternatives" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "exercise_alternatives" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "session_exercise_swaps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_exercise_swaps" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "session_exercise_swaps" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
