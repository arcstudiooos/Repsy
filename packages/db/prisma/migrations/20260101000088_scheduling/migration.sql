-- PRD K10, K11, H15 (D-013 #11, #12): clients book sessions with their coach. A session type has a length, buffers,
-- notice and booking windows, a cancel window, an optional https call link or a location, and whether it uses a
-- session credit. Availability is weekly hours in the coach's zone plus time off. A booking blocks its time
-- including buffers; bookings are serialised per coach (membership row lock) so two never overlap. Session packs are
-- purchases with credits. Calendar connections push bookings out and cache busy intervals (never event details).
-- Every table is tenant-owned with forced RLS and composite tenant FKs.

CREATE TABLE "session_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "coach_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "buffer_before_min" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min" INTEGER NOT NULL DEFAULT 0,
    "min_notice_hours" INTEGER NOT NULL DEFAULT 12,
    "max_days_ahead" INTEGER NOT NULL DEFAULT 30,
    "cancel_window_hours" INTEGER NOT NULL DEFAULT 24,
    "call_link" TEXT,
    "location" TEXT,
    "uses_credit" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "session_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "session_types_id_organization_id_key" ON "session_types"("id", "organization_id");
CREATE INDEX "session_types_organization_id_coach_user_id_idx" ON "session_types"("organization_id", "coach_user_id");
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_check" CHECK (
  length("title") BETWEEN 1 AND 80
  AND "kind" IN ('call', 'checkin_call', 'in_person')
  AND "duration_min" BETWEEN 10 AND 240
  AND "buffer_before_min" BETWEEN 0 AND 120
  AND "buffer_after_min" BETWEEN 0 AND 120
  AND "min_notice_hours" BETWEEN 0 AND 336
  AND "max_days_ahead" BETWEEN 1 AND 180
  AND "cancel_window_hours" BETWEEN 0 AND 168
  AND ("call_link" IS NULL OR ("call_link" ~ '^https://' AND length("call_link") <= 500))
  AND ("location" IS NULL OR length("location") BETWEEN 1 AND 200)
);

CREATE TABLE "coach_availability" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "coach_user_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coach_availability_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coach_availability_organization_id_coach_user_id_idx" ON "coach_availability"("organization_id", "coach_user_id");
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_check" CHECK (
  "weekday" BETWEEN 1 AND 7
  AND "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
  AND "start_time" < "end_time"
  AND length("timezone") BETWEEN 1 AND 64
);

CREATE TABLE "coach_time_off" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "coach_user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coach_time_off_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coach_time_off_organization_id_coach_user_id_starts_at_idx" ON "coach_time_off"("organization_id", "coach_user_id", "starts_at");
ALTER TABLE "coach_time_off" ADD CONSTRAINT "coach_time_off_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_time_off" ADD CONSTRAINT "coach_time_off_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_time_off" ADD CONSTRAINT "coach_time_off_check" CHECK (
  "starts_at" < "ends_at"
  AND ("note" IS NULL OR length("note") <= 200)
);

-- K11: a purchase of a package with session credits is a session pack.
ALTER TABLE "purchases" ADD COLUMN "credits_total" INTEGER;
ALTER TABLE "purchases" ADD COLUMN "credits_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchases" ADD COLUMN "credits_expire_at" TIMESTAMPTZ(3);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_credits_check" CHECK (
  ("credits_total" IS NULL OR "credits_total" BETWEEN 1 AND 500)
  AND "credits_used" >= 0
  AND ("credits_total" IS NULL OR "credits_used" <= "credits_total")
);

CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_type_id" UUID NOT NULL,
    "coach_user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_from" TIMESTAMPTZ(3) NOT NULL,
    "blocked_to" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "title" TEXT NOT NULL,
    "call_link" TEXT,
    "location" TEXT,
    "credit_purchase_id" UUID,
    "credit_returned" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by" UUID,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "sync_state" TEXT NOT NULL DEFAULT 'none',
    "sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "calendar_event_ref" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bookings_id_organization_id_key" ON "bookings"("id", "organization_id");
CREATE INDEX "bookings_organization_id_coach_user_id_starts_at_idx" ON "bookings"("organization_id", "coach_user_id", "starts_at");
CREATE INDEX "bookings_organization_id_client_id_starts_at_idx" ON "bookings"("organization_id", "client_id", "starts_at");
CREATE INDEX "bookings_reminder_due_idx" ON "bookings"("starts_at") WHERE "status" = 'booked' AND "reminder_sent_at" IS NULL;
CREATE INDEX "bookings_sync_pending_idx" ON "bookings"("updated_at") WHERE "sync_state" = 'pending';
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_type_id_organization_id_fkey" FOREIGN KEY ("session_type_id", "organization_id") REFERENCES "session_types"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_credit_purchase_id_organization_id_fkey" FOREIGN KEY ("credit_purchase_id", "organization_id") REFERENCES "purchases"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_canceled_by_fkey" FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_check" CHECK (
  "starts_at" < "ends_at"
  AND "blocked_from" <= "starts_at"
  AND "blocked_to" >= "ends_at"
  AND "status" IN ('booked', 'canceled', 'completed', 'no_show')
  AND "sync_state" IN ('none', 'pending', 'synced', 'failed')
  AND length("title") BETWEEN 1 AND 80
  AND ("call_link" IS NULL OR ("call_link" ~ '^https://' AND length("call_link") <= 500))
  AND ("location" IS NULL OR length("location") <= 200)
);

CREATE TABLE "calendar_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "account_email" TEXT,
    "token_ciphertext" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "status" TEXT NOT NULL DEFAULT 'active',
    "busy_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_connections_organization_id_user_id_key" ON "calendar_connections"("organization_id", "user_id");
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_check" CHECK (
  "provider" IN ('google', 'outlook', 'fake')
  AND "status" IN ('active', 'revoked', 'error')
  AND length("calendar_id") BETWEEN 1 AND 200
);

CREATE TABLE "calendar_busy" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "calendar_busy_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "calendar_busy_organization_id_user_id_starts_at_idx" ON "calendar_busy"("organization_id", "user_id", "starts_at");
ALTER TABLE "calendar_busy" ADD CONSTRAINT "calendar_busy_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_busy" ADD CONSTRAINT "calendar_busy_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_busy" ADD CONSTRAINT "calendar_busy_check" CHECK ("starts_at" < "ends_at");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['session_types', 'coach_availability', 'coach_time_off', 'bookings', 'calendar_connections', 'calendar_busy'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
