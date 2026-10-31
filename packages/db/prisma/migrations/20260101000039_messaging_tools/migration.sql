-- PRD H4 saved replies (shared per workspace) and H16 reply expectations (usual reply time and office hours shown
-- to clients). Forced RLS on saved_replies.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "office_hours" TEXT,
ADD COLUMN     "reply_target_hours" INTEGER;

-- CreateTable
CREATE TABLE "saved_replies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_replies_organization_id_idx" ON "saved_replies"("organization_id");

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "organizations" ADD CONSTRAINT "organizations_reply_target_check" CHECK (
  "reply_target_hours" IS NULL OR "reply_target_hours" IN (4, 12, 24, 48, 72)
);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_office_hours_check" CHECK (
  "office_hours" IS NULL OR char_length("office_hours") BETWEEN 1 AND 200
);
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_title_check" CHECK (char_length("title") BETWEEN 1 AND 60);
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_body_check" CHECK (char_length("body") BETWEEN 1 AND 2000);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "saved_replies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_replies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "saved_replies" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
