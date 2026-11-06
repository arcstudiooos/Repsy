-- PRD A15: locations, for studios with several sites. Clients and staff can belong to one location.
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "locations_id_organization_id_key" ON "locations"("id", "organization_id");
CREATE INDEX "locations_organization_id_idx" ON "locations"("organization_id");
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clients" ADD COLUMN "location_id" UUID;
ALTER TABLE "clients" ADD CONSTRAINT "clients_location_id_organization_id_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "locations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "clients_organization_id_location_id_idx" ON "clients"("organization_id", "location_id");

ALTER TABLE "memberships" ADD COLUMN "location_id" UUID;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_location_id_organization_id_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "locations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PRD K12: group classes with capacity, waitlist and attendance.
CREATE TABLE "group_classes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location_id" UUID,
    "coach_user_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_classes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_classes_id_organization_id_key" ON "group_classes"("id", "organization_id");
CREATE INDEX "group_classes_organization_id_starts_at_idx" ON "group_classes"("organization_id", "starts_at");
CREATE INDEX "group_classes_series_id_idx" ON "group_classes"("series_id");
ALTER TABLE "group_classes" ADD CONSTRAINT "group_classes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_classes" ADD CONSTRAINT "group_classes_location_id_organization_id_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "locations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_classes" ADD CONSTRAINT "group_classes_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_classes" ADD CONSTRAINT "group_classes_check" CHECK (
  "ends_at" > "starts_at" AND "capacity" BETWEEN 1 AND 500
);

CREATE TABLE "class_enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "attended" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "class_enrollments_class_id_client_id_key" ON "class_enrollments"("class_id", "client_id");
CREATE INDEX "class_enrollments_organization_id_client_id_idx" ON "class_enrollments"("organization_id", "client_id");
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_id_organization_id_fkey" FOREIGN KEY ("class_id", "organization_id") REFERENCES "group_classes"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_check" CHECK (
  "status" IN ('booked', 'waitlisted', 'cancelled')
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['locations', 'group_classes', 'class_enrollments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
