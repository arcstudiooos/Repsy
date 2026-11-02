-- PRD H9: time-boxed challenges (workouts done, habit check-ins or training volume) that clients join, with a
-- leaderboard each participant chooses to appear on (display names only). Body metrics are never a challenge.
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "start_local_date" DATE NOT NULL,
    "end_local_date" DATE NOT NULL,
    "group_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "challenges_id_organization_id_key" ON "challenges"("id", "organization_id");
CREATE INDEX "challenges_organization_id_idx" ON "challenges"("organization_id");
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "groups"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("description") <= 2000
  AND "metric" IN ('workouts', 'habit_days', 'volume')
  AND "end_local_date" >= "start_local_date" AND "end_local_date" - "start_local_date" <= 366
);

CREATE TABLE "challenge_participants" (
    "challenge_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "on_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("challenge_id", "client_id")
);
CREATE INDEX "challenge_participants_organization_id_client_id_idx" ON "challenge_participants"("organization_id", "client_id");
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_organization_id_fkey" FOREIGN KEY ("challenge_id", "organization_id") REFERENCES "challenges"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['challenges', 'challenge_participants'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
