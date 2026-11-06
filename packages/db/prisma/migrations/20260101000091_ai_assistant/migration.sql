-- PRD I15: the AI assistant. Each conversation belongs to one staff user in one workspace; only that
-- user can read it (enforced in core). Messages hold the visible text plus the names of the read-only
-- tools the assistant used, never raw tool output.
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_conversations_id_organization_id_key" ON "ai_conversations"("id", "organization_id");
CREATE INDEX "ai_conversations_organization_id_user_id_updated_at_idx" ON "ai_conversations"("organization_id", "user_id", "updated_at");
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tools_used" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");
CREATE INDEX "ai_messages_organization_id_idx" ON "ai_messages"("organization_id");
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_organization_id_fkey" FOREIGN KEY ("conversation_id", "organization_id") REFERENCES "ai_conversations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_check" CHECK ("role" IN ('user', 'assistant'));

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_conversations', 'ai_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
