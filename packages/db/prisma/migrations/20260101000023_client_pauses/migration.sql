-- S3-5 client pauses (D-003, Ruling 6). A pause moves the client's scheduled sessions from its start date forward;
-- `applied_offset_days` records how far, so changing the resume date or resuming early shifts only the difference.
-- The composite (client_id, organization_id) FK keeps a pause in its client's org. At most one open pause per client
-- (partial unique index; Prisma cannot model it).

-- CreateTable
CREATE TABLE "client_pauses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "start_local_date" DATE NOT NULL,
    "resume_local_date" DATE NOT NULL,
    "applied_offset_days" INTEGER NOT NULL DEFAULT 0,
    "ended_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_pauses_client_id_idx" ON "client_pauses"("client_id");

-- CreateIndex
CREATE INDEX "client_pauses_organization_id_idx" ON "client_pauses"("organization_id");

-- CreateIndex
CREATE INDEX "client_pauses_ended_at_resume_local_date_idx" ON "client_pauses"("ended_at", "resume_local_date");

-- AddForeignKey
ALTER TABLE "client_pauses" ADD CONSTRAINT "client_pauses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_pauses" ADD CONSTRAINT "client_pauses_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_pauses" ADD CONSTRAINT "client_pauses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateIndex
CREATE UNIQUE INDEX "client_pauses_one_open_per_client" ON "client_pauses"("client_id") WHERE "ended_at" IS NULL;

-- A pause lasts 1-90 days and never moves sessions backwards (the API validates this as well).
ALTER TABLE "client_pauses" ADD CONSTRAINT "client_pauses_dates_check" CHECK (
  "resume_local_date" > "start_local_date" AND "resume_local_date" - "start_local_date" <= 90
);
ALTER TABLE "client_pauses" ADD CONSTRAINT "client_pauses_offset_check" CHECK ("applied_offset_days" BETWEEN 0 AND 90);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "client_pauses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_pauses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_pauses" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
