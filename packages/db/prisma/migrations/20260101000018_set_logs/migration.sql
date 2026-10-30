-- S2-2 set logs (F08, D-004 #7, D-008 #8). One row per (session, workout version exercise, set index): the unique key
-- is what makes replays idempotent. Weight is stored in kg (Decimal(7,3)). Tenant links are composite
-- (fk, organization_id) FKs, so a set log can never point at another organization's session or exercise row.
-- Adding UNIQUE (id, organization_id) on workout_version_exercises is DDL only: the immutability triggers
-- (migration 000014) fire on row UPDATE/DELETE, not on index creation.

-- CreateTable
CREATE TABLE "set_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "workout_version_exercise_id" UUID NOT NULL,
    "set_index" INTEGER NOT NULL,
    "reps" INTEGER,
    "weight_kg" DECIMAL(7,3),
    "rpe" DECIMAL(3,1),
    "duration_seconds" INTEGER,
    "distance_m" DECIMAL(9,3),
    "client_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "client_mutation_id" UUID NOT NULL,
    "logged_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "set_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "set_logs_organization_id_idx" ON "set_logs"("organization_id");

-- CreateIndex
CREATE INDEX "set_logs_workout_version_exercise_id_idx" ON "set_logs"("workout_version_exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "set_logs_session_id_workout_version_exercise_id_set_index_key" ON "set_logs"("session_id", "workout_version_exercise_id", "set_index");

-- CreateIndex
CREATE UNIQUE INDEX "workout_sessions_id_organization_id_key" ON "workout_sessions"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_version_exercises_id_organization_id_key" ON "workout_version_exercises"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "workout_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_workout_version_exercise_id_organization_id_fkey" FOREIGN KEY ("workout_version_exercise_id", "organization_id") REFERENCES "workout_version_exercises"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_logged_by_user_id_fkey" FOREIGN KEY ("logged_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Validation ranges (PRD §9.1 / S2-2), enforced by the database as well as by the API.
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_ranges_check" CHECK (
  "set_index" BETWEEN 0 AND 19
  AND ("reps" IS NULL OR "reps" BETWEEN 0 AND 1000)
  AND ("weight_kg" IS NULL OR "weight_kg" BETWEEN 0 AND 2000)
  AND ("rpe" IS NULL OR "rpe" BETWEEN 1 AND 10)
  AND ("duration_seconds" IS NULL OR "duration_seconds" BETWEEN 0 AND 86400)
  AND ("distance_m" IS NULL OR "distance_m" BETWEEN 0 AND 100000)
);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "set_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "set_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "set_logs" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
