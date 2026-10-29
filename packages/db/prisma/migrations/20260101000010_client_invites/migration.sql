-- AlterTable
ALTER TABLE "outbox_emails" ADD COLUMN     "to_email" TEXT,
ALTER COLUMN "to_user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "client_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_invites_token_hash_key" ON "client_invites"("token_hash");

-- CreateIndex
CREATE INDEX "client_invites_client_id_idx" ON "client_invites"("client_id");

-- CreateIndex
CREATE INDEX "client_invites_organization_id_idx" ON "client_invites"("organization_id");

-- AddForeignKey
ALTER TABLE "client_invites" ADD CONSTRAINT "client_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invites" ADD CONSTRAINT "client_invites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invites" ADD CONSTRAINT "client_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- An outbox email is addressed by exactly one of account (to_user_id) or raw address (to_email).
ALTER TABLE "outbox_emails" ADD CONSTRAINT "outbox_emails_recipient_check"
  CHECK (("to_user_id" IS NOT NULL) <> ("to_email" IS NOT NULL));

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "client_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_invites" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_invites" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
