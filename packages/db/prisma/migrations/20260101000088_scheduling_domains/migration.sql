-- PRD K10/K11/H15/J4/J6/L4/M12: bookable session types and bookings (with a
-- Zoom/Meet call link), in-person session packs, package journey runs,
-- custom domains with verification tokens, and subscription lapses.
-- Every table carries organization_id and the tenant_isolation policy, in the
-- style of migration 20260101000084. package_journey_runs.package_id has NO
-- foreign key: the billing_packages table (K3, billing slice) does not exist
-- yet, and this slice codes against its assumed fields (see
-- SCHEMA_SNIPPET_SCHEDULING.md). Add the FK when billing lands.
CREATE TABLE "session_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "coach_user_id" UUID,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "reminder_minutes_before" INTEGER NOT NULL DEFAULT 60,
    "location" TEXT,
    "availability_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "session_types_id_organization_id_key" ON "session_types"("id", "organization_id");
CREATE INDEX "session_types_organization_id_idx" ON "session_types"("organization_id");
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_check" CHECK (
  length("name") BETWEEN 1 AND 120 AND "kind" IN ('call', 'checkin_call', 'in_person')
  AND "duration_minutes" BETWEEN 5 AND 480
  AND "buffer_before_minutes" BETWEEN 0 AND 120 AND "buffer_after_minutes" BETWEEN 0 AND 120
  AND "reminder_minutes_before" BETWEEN 15 AND 1440
);

CREATE TABLE "session_packs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "used_sessions" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_packs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "session_packs_id_organization_id_key" ON "session_packs"("id", "organization_id");
CREATE INDEX "session_packs_organization_id_client_id_idx" ON "session_packs"("organization_id", "client_id");
ALTER TABLE "session_packs" ADD CONSTRAINT "session_packs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_packs" ADD CONSTRAINT "session_packs_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_packs" ADD CONSTRAINT "session_packs_check" CHECK (
  length("name") BETWEEN 1 AND 120 AND "total_sessions" BETWEEN 1 AND 500
  AND "used_sessions" >= 0 AND "used_sessions" <= "total_sessions"
  AND "status" IN ('active', 'exhausted', 'expired')
);

CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_type_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "coach_user_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "call_link" TEXT,
    "pack_id" UUID,
    "pack_consumed" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bookings_id_organization_id_key" ON "bookings"("id", "organization_id");
CREATE INDEX "bookings_organization_id_client_id_idx" ON "bookings"("organization_id", "client_id");
CREATE INDEX "bookings_organization_id_coach_starts_idx" ON "bookings"("organization_id", "coach_user_id", "starts_at");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_type_id_organization_id_fkey" FOREIGN KEY ("session_type_id", "organization_id") REFERENCES "session_types"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pack_id_organization_id_fkey" FOREIGN KEY ("pack_id", "organization_id") REFERENCES "session_packs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_check" CHECK (
  "ends_at" > "starts_at" AND "status" IN ('booked', 'cancelled', 'completed')
  AND ("call_link" IS NULL OR "call_link" LIKE 'http://%' OR "call_link" LIKE 'https://%')
);

CREATE TABLE "package_journey_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "sequence_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "steps_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    CONSTRAINT "package_journey_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "package_journey_runs_id_organization_id_key" ON "package_journey_runs"("id", "organization_id");
CREATE UNIQUE INDEX "package_journey_runs_package_client_idx" ON "package_journey_runs"("package_id", "client_id");
CREATE INDEX "package_journey_runs_organization_id_client_id_idx" ON "package_journey_runs"("organization_id", "client_id");
ALTER TABLE "package_journey_runs" ADD CONSTRAINT "package_journey_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_journey_runs" ADD CONSTRAINT "package_journey_runs_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_journey_runs" ADD CONSTRAINT "package_journey_runs_check" CHECK (
  "source" IN ('sequence', 'package_steps')
  AND "status" IN ('active', 'done', 'skipped', 'failed')
);

CREATE TABLE "custom_domains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "branded_from_local" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "custom_domains_id_organization_id_key" ON "custom_domains"("id", "organization_id");
CREATE UNIQUE INDEX "custom_domains_hostname_key" ON "custom_domains"("hostname");
CREATE INDEX "custom_domains_organization_id_idx" ON "custom_domains"("organization_id");
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_check" CHECK (
  "status" IN ('requested', 'verified')
  AND ("status" = 'requested' OR "verified_at" IS NOT NULL)
);

CREATE TABLE "subscription_lapses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lapsed_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_lapses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscription_lapses_id_organization_id_key" ON "subscription_lapses"("id", "organization_id");
CREATE INDEX "subscription_lapses_organization_id_lapsed_idx" ON "subscription_lapses"("organization_id", "lapsed_at");
ALTER TABLE "subscription_lapses" ADD CONSTRAINT "subscription_lapses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['session_types', 'bookings', 'session_packs', 'package_journey_runs', 'custom_domains', 'subscription_lapses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
