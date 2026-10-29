-- CreateEnum
CREATE TYPE "client_status" AS ENUM ('invited', 'active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "units" AS ENUM ('kg', 'lb');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "coach_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "client_status" NOT NULL DEFAULT 'invited',
    "start_date" DATE,
    "goals" TEXT,
    "timezone" TEXT NOT NULL,
    "preferred_units" "units" NOT NULL DEFAULT 'kg',
    "consent_version" TEXT,
    "consent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_organization_id_status_idx" ON "clients"("organization_id", "status");

-- CreateIndex
CREATE INDEX "clients_organization_id_created_at_id_idx" ON "clients"("organization_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_email_key" ON "clients"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_user_id_key" ON "clients"("organization_id", "user_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clients" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
