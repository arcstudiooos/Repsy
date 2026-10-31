-- PRD E1 body metrics: one value per client, metric and client-local day (metric_entries), and an append-only
-- history of changes to a value (metric_entry_revisions). Composite (client_id, organization_id) FKs; forced RLS.
-- Per-metric value ranges are enforced in core; the CHECK here is a coarse backstop.

-- CreateEnum
CREATE TYPE "body_metric" AS ENUM ('weight', 'body_fat', 'waist', 'hips', 'chest', 'arm', 'thigh', 'resting_hr', 'steps');

-- CreateEnum
CREATE TYPE "metric_source" AS ENUM ('client', 'coach');

-- CreateTable
CREATE TABLE "metric_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "metric" "body_metric" NOT NULL,
    "measured_on" DATE NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "source" "metric_source" NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "metric_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_entry_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "before_value" DECIMAL(10,3) NOT NULL,
    "after_value" DECIMAL(10,3) NOT NULL,
    "role" "metric_source" NOT NULL,
    "reason" TEXT,
    "revised_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_entry_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metric_entries_organization_id_idx" ON "metric_entries"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "metric_entries_client_id_metric_measured_on_key" ON "metric_entries"("client_id", "metric", "measured_on");

-- CreateIndex
CREATE UNIQUE INDEX "metric_entries_id_organization_id_key" ON "metric_entries"("id", "organization_id");

-- CreateIndex
CREATE INDEX "metric_entry_revisions_entry_id_created_at_idx" ON "metric_entry_revisions"("entry_id", "created_at");

-- CreateIndex
CREATE INDEX "metric_entry_revisions_organization_id_idx" ON "metric_entry_revisions"("organization_id");

-- CreateIndex
CREATE INDEX "metric_entry_revisions_client_id_idx" ON "metric_entry_revisions"("client_id");

-- AddForeignKey
ALTER TABLE "metric_entries" ADD CONSTRAINT "metric_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_entries" ADD CONSTRAINT "metric_entries_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_entries" ADD CONSTRAINT "metric_entries_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_entry_revisions" ADD CONSTRAINT "metric_entry_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_entry_revisions" ADD CONSTRAINT "metric_entry_revisions_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_entry_revisions" ADD CONSTRAINT "metric_entry_revisions_entry_id_organization_id_fkey" FOREIGN KEY ("entry_id", "organization_id") REFERENCES "metric_entries"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_entry_revisions" ADD CONSTRAINT "metric_entry_revisions_revised_by_user_id_fkey" FOREIGN KEY ("revised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "metric_entries" ADD CONSTRAINT "metric_entries_value_check" CHECK ("value" > 0 AND "value" < 1000000);
ALTER TABLE "metric_entry_revisions" ADD CONSTRAINT "metric_entry_revisions_values_check" CHECK (
  "before_value" > 0 AND "before_value" < 1000000 AND "after_value" > 0 AND "after_value" < 1000000
);
ALTER TABLE "metric_entry_revisions" ADD CONSTRAINT "metric_entry_revisions_reason_check" CHECK (
  "reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500
);

-- Append-only, except lawful erasure in system scope (the erasure job), as for set_log_revisions (migration 000032).
CREATE FUNCTION metric_entry_revisions_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on'
     AND app_rls_bypass() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'metric_entry_revisions is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER metric_entry_revisions_no_update
  BEFORE UPDATE OR DELETE ON "metric_entry_revisions"
  FOR EACH ROW EXECUTE FUNCTION metric_entry_revisions_reject_change();
CREATE TRIGGER metric_entry_revisions_no_truncate
  BEFORE TRUNCATE ON "metric_entry_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION metric_entry_revisions_reject_change();

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "metric_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metric_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "metric_entries" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "metric_entry_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metric_entry_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "metric_entry_revisions" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
