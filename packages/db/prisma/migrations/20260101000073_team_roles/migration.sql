-- PRD A10 (team rollout, D-003 notes): Admin and Assistant join Owner, Coach and Client. Admins run the workspace
-- with the owner (not its data export or ownership); assistants message and review but don't edit programs, clients
-- or settings. Teammates join by an emailed invite; only the token's sha256 is stored.
ALTER TYPE "membership_role" ADD VALUE 'admin';
ALTER TYPE "membership_role" ADD VALUE 'assistant';

CREATE TABLE "team_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "team_invites_token_hash_key" ON "team_invites"("token_hash");
CREATE INDEX "team_invites_organization_id_idx" ON "team_invites"("organization_id");
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_check" CHECK (
  "role" IN ('admin', 'coach', 'assistant') AND length("email") BETWEEN 3 AND 320
);

ALTER TABLE "team_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_invites" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "team_invites" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
