-- PRD K10: two-way Google Calendar sync. A staff user connects their own Google calendar; bookings
-- they coach are pushed to it, and its busy times block new bookings. The refresh token is stored
-- encrypted (AES-256-GCM, key from CALENDAR_TOKEN_KEY or derived from BETTER_AUTH_SECRET).
CREATE TABLE "calendar_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "account_email" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_connections_id_organization_id_key" ON "calendar_connections"("id", "organization_id");
CREATE UNIQUE INDEX "calendar_connections_organization_id_user_id_provider_key" ON "calendar_connections"("organization_id", "user_id", "provider");
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_check" CHECK (
  "provider" = 'google' AND "status" IN ('active', 'error')
);

ALTER TABLE "calendar_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "calendar_connections" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

-- Which Google event mirrors a booking, and the sync outcome. The worker pushes a booking once
-- (calendar_synced_at), and removes the event when the booking is cancelled.
ALTER TABLE "bookings" ADD COLUMN "external_event_id" TEXT;
ALTER TABLE "bookings" ADD COLUMN "calendar_synced_at" TIMESTAMPTZ(3);
ALTER TABLE "bookings" ADD COLUMN "calendar_error" TEXT;
CREATE INDEX "bookings_calendar_pending_idx" ON "bookings"("starts_at") WHERE "calendar_synced_at" IS NULL OR ("cancelled_at" IS NOT NULL AND "external_event_id" IS NOT NULL);
