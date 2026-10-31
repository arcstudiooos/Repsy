-- PRD G6/G7 nutrition: daily targets a coach sets (with effective dates) and the client's daily totals. Composite
-- tenant FKs; forced RLS. No medical diets or claims (D-007).

-- CreateTable
CREATE TABLE "nutrition_targets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "calories" INTEGER,
    "protein_g" INTEGER,
    "carbs_g" INTEGER,
    "fat_g" INTEGER,
    "set_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "calories" INTEGER,
    "protein_g" INTEGER,
    "carbs_g" INTEGER,
    "fat_g" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nutrition_targets_organization_id_idx" ON "nutrition_targets"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_targets_client_id_effective_from_key" ON "nutrition_targets"("client_id", "effective_from");

-- CreateIndex
CREATE INDEX "nutrition_logs_organization_id_idx" ON "nutrition_logs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_logs_client_id_local_date_key" ON "nutrition_logs"("client_id", "local_date");

-- AddForeignKey
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_set_by_user_id_fkey" FOREIGN KEY ("set_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_logs" ADD CONSTRAINT "nutrition_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_logs" ADD CONSTRAINT "nutrition_logs_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_values_check" CHECK (
  ("calories" IS NULL OR "calories" BETWEEN 500 AND 10000)
  AND ("protein_g" IS NULL OR "protein_g" BETWEEN 0 AND 1000)
  AND ("carbs_g" IS NULL OR "carbs_g" BETWEEN 0 AND 2000)
  AND ("fat_g" IS NULL OR "fat_g" BETWEEN 0 AND 1000)
  AND num_nonnulls("calories", "protein_g", "carbs_g", "fat_g") > 0
);
ALTER TABLE "nutrition_logs" ADD CONSTRAINT "nutrition_logs_values_check" CHECK (
  ("calories" IS NULL OR "calories" BETWEEN 0 AND 20000)
  AND ("protein_g" IS NULL OR "protein_g" BETWEEN 0 AND 2000)
  AND ("carbs_g" IS NULL OR "carbs_g" BETWEEN 0 AND 4000)
  AND ("fat_g" IS NULL OR "fat_g" BETWEEN 0 AND 2000)
  AND num_nonnulls("calories", "protein_g", "carbs_g", "fat_g") > 0
);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "nutrition_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutrition_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "nutrition_targets" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "nutrition_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutrition_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "nutrition_logs" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
