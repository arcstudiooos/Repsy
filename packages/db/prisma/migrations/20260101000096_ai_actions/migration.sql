-- PRD I15 (actions): the AI assistant can propose changes (assign a program, set daily nutrition targets, build and
-- give a meal plan). A proposal does nothing until the coach who asked confirms it; it then runs the same domain
-- function the screens use, with that coach's permissions. Off unless a manager turns actions on.
ALTER TABLE "ai_settings" ADD COLUMN "actions_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ai_actions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "user_id" UUID NOT NULL,
    "client_id" UUID,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_actions_kind_check" CHECK ("kind" IN ('assign_program', 'set_nutrition_targets', 'meal_plan', 'assign_meal_plan')),
    CONSTRAINT "ai_actions_status_check" CHECK ("status" IN ('proposed', 'applied', 'cancelled', 'failed', 'expired'))
);
CREATE INDEX "ai_actions_conversation_id_idx" ON "ai_actions"("conversation_id");
CREATE INDEX "ai_actions_organization_id_client_id_idx" ON "ai_actions"("organization_id", "client_id");
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_conversation_id_organization_id_fkey" FOREIGN KEY ("conversation_id", "organization_id") REFERENCES "ai_conversations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_actions" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
