-- S4-5 internal notes (F12): a coach's private notes about a client. Composite (client_id, organization_id) FK;
-- forced RLS. Clients never reach them (core policy note:read/note:write is coach/owner only).

-- CreateTable
CREATE TABLE "internal_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_notes_client_id_created_at_idx" ON "internal_notes"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_notes_organization_id_idx" ON "internal_notes"("organization_id");

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_body_check" CHECK (char_length("body") BETWEEN 1 AND 4000);

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "internal_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "internal_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "internal_notes" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
