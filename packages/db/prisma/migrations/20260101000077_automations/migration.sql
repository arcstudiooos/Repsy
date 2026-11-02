-- PRD J1-J3, J7-J9: automations. A sequence is a trigger and ordered steps on day N at a client-local time. Client
-- events (invite accepted, intake or check-in sent, program finished, tag added, stage changed) are written in the
-- same transaction as what caused them; the worker starts runs from them and runs due steps as the sequence's coach.
-- A step can ask first (J7): it waits in the review queue for one-tap approval. Every step run is kept (J8).
CREATE TABLE "client_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "detail_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    CONSTRAINT "client_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_events_unprocessed_idx" ON "client_events"("created_at") WHERE "processed_at" IS NULL;
CREATE INDEX "client_events_organization_id_client_id_idx" ON "client_events"("organization_id", "client_id");
ALTER TABLE "client_events" ADD CONSTRAINT "client_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_events" ADD CONSTRAINT "client_events_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "trigger_value" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sequences_id_organization_id_key" ON "sequences"("id", "organization_id");
CREATE INDEX "sequences_organization_id_trigger_idx" ON "sequences"("organization_id", "trigger");
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_check" CHECK (
  length("name") BETWEEN 1 AND 120
  AND "trigger" IN ('manual', 'invite_accepted', 'intake_submitted', 'checkin_submitted', 'program_finished', 'tag_added', 'stage_changed')
);

CREATE TABLE "sequence_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "day_offset" INTEGER NOT NULL,
    "local_time" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "ask_first" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sequence_steps_id_organization_id_key" ON "sequence_steps"("id", "organization_id");
CREATE INDEX "sequence_steps_sequence_id_idx" ON "sequence_steps"("sequence_id");
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_organization_id_fkey" FOREIGN KEY ("sequence_id", "organization_id") REFERENCES "sequences"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_check" CHECK (
  "day_offset" BETWEEN 0 AND 365 AND "local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND "type" IN ('message', 'form', 'habit', 'tag_add', 'tag_remove', 'program', 'followup')
);

CREATE TABLE "sequence_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    CONSTRAINT "sequence_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sequence_runs_id_organization_id_key" ON "sequence_runs"("id", "organization_id");
CREATE UNIQUE INDEX "sequence_runs_one_active" ON "sequence_runs"("sequence_id", "client_id") WHERE "status" = 'active';
CREATE INDEX "sequence_runs_organization_id_client_id_idx" ON "sequence_runs"("organization_id", "client_id");
ALTER TABLE "sequence_runs" ADD CONSTRAINT "sequence_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sequence_runs" ADD CONSTRAINT "sequence_runs_sequence_id_organization_id_fkey" FOREIGN KEY ("sequence_id", "organization_id") REFERENCES "sequences"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sequence_runs" ADD CONSTRAINT "sequence_runs_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sequence_runs" ADD CONSTRAINT "sequence_runs_check" CHECK ("status" IN ('active', 'done', 'cancelled'));

CREATE TABLE "sequence_step_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "executed_at" TIMESTAMPTZ(3),
    "error" TEXT,
    CONSTRAINT "sequence_step_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sequence_step_runs_run_id_step_id_key" ON "sequence_step_runs"("run_id", "step_id");
CREATE INDEX "sequence_step_runs_due_idx" ON "sequence_step_runs"("due_at") WHERE "status" = 'pending';
ALTER TABLE "sequence_step_runs" ADD CONSTRAINT "sequence_step_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sequence_step_runs" ADD CONSTRAINT "sequence_step_runs_run_id_organization_id_fkey" FOREIGN KEY ("run_id", "organization_id") REFERENCES "sequence_runs"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sequence_step_runs" ADD CONSTRAINT "sequence_step_runs_step_id_organization_id_fkey" FOREIGN KEY ("step_id", "organization_id") REFERENCES "sequence_steps"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sequence_step_runs" ADD CONSTRAINT "sequence_step_runs_check" CHECK (
  "status" IN ('pending', 'waiting', 'done', 'failed', 'skipped')
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_events', 'sequences', 'sequence_steps', 'sequence_runs', 'sequence_step_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;

ALTER TYPE "review_rule" ADD VALUE 'automation_approval';
ALTER TYPE "review_rule" ADD VALUE 'automation_failed';
