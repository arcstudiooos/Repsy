-- PRD G8, G9: recipes and meal plans. A recipe has ingredients, steps, macros per serving and a photo; a meal plan is
-- days x meals, each meal with one or more options (a recipe, or a described option with macros), or an uploaded PDF.
-- One plan at a time per client. Workspace nutrition files (recipe photos, plan PDFs) belong to no client.
ALTER TABLE "media_files" DROP CONSTRAINT "media_files_check";
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_check" CHECK (
  "purpose" IN ('progress_photo', 'message', 'form_check', 'exercise_demo', 'nutrition')
  AND ("purpose" IN ('exercise_demo', 'nutrition')) = ("client_id" IS NULL)
  AND "content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4')
  AND "bytes" BETWEEN 1 AND 104857600
);

CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "servings" INTEGER NOT NULL DEFAULT 1,
    "ingredients_json" JSONB NOT NULL DEFAULT '[]',
    "steps" TEXT NOT NULL DEFAULT '',
    "calories" INTEGER,
    "protein_g" INTEGER,
    "carbs_g" INTEGER,
    "fat_g" INTEGER,
    "photo_media_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recipes_id_organization_id_key" ON "recipes"("id", "organization_id");
CREATE INDEX "recipes_organization_id_idx" ON "recipes"("organization_id");
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_photo_media_id_organization_id_fkey" FOREIGN KEY ("photo_media_id", "organization_id") REFERENCES "media_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND "servings" BETWEEN 1 AND 50 AND length("steps") <= 10000
  AND jsonb_typeof("ingredients_json") = 'array'
  AND ("calories" IS NULL OR "calories" BETWEEN 0 AND 5000)
  AND ("protein_g" IS NULL OR "protein_g" BETWEEN 0 AND 500)
  AND ("carbs_g" IS NULL OR "carbs_g" BETWEEN 0 AND 1000)
  AND ("fat_g" IS NULL OR "fat_g" BETWEEN 0 AND 500)
);

CREATE TABLE "meal_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "days_json" JSONB NOT NULL DEFAULT '[]',
    "pdf_media_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "meal_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "meal_plans_id_organization_id_key" ON "meal_plans"("id", "organization_id");
CREATE INDEX "meal_plans_organization_id_idx" ON "meal_plans"("organization_id");
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_pdf_media_id_organization_id_fkey" FOREIGN KEY ("pdf_media_id", "organization_id") REFERENCES "media_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("notes") <= 4000 AND jsonb_typeof("days_json") = 'array'
);

CREATE TABLE "client_meal_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "meal_plan_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    CONSTRAINT "client_meal_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_meal_plans_one_open" ON "client_meal_plans"("client_id") WHERE "ended_at" IS NULL;
CREATE INDEX "client_meal_plans_organization_id_client_id_idx" ON "client_meal_plans"("organization_id", "client_id");
ALTER TABLE "client_meal_plans" ADD CONSTRAINT "client_meal_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_meal_plans" ADD CONSTRAINT "client_meal_plans_meal_plan_id_organization_id_fkey" FOREIGN KEY ("meal_plan_id", "organization_id") REFERENCES "meal_plans"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_meal_plans" ADD CONSTRAINT "client_meal_plans_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['recipes', 'meal_plans', 'client_meal_plans'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
