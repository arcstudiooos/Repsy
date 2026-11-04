-- S4-4 messaging (D-008 #1): one thread per client, text messages. Tenant links are composite
-- (fk, organization_id) FKs. Messages are immutable: only read_at may change (lawful deletion, D-008 #16, stays
-- possible). (thread_id, client_message_id) makes a retried send idempotent.

-- CreateTable
CREATE TABLE "conversation_threads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "coach_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "client_message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_threads_client_id_key" ON "conversation_threads"("client_id");

-- CreateIndex
CREATE INDEX "conversation_threads_organization_id_idx" ON "conversation_threads"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_threads_id_organization_id_key" ON "conversation_threads"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_threads_client_id_organization_id_key" ON "conversation_threads"("client_id", "organization_id");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_id_idx" ON "messages"("thread_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "messages_organization_id_read_at_idx" ON "messages"("organization_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_thread_id_client_message_id_key" ON "messages"("thread_id", "client_message_id");

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_organization_id_fkey" FOREIGN KEY ("thread_id", "organization_id") REFERENCES "conversation_threads"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "messages" ADD CONSTRAINT "messages_body_check" CHECK (char_length("body") BETWEEN 1 AND 4000);

CREATE FUNCTION messages_reject_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
     OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.client_message_id IS DISTINCT FROM OLD.client_message_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'messages are immutable: only read_at may change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_immutable
  BEFORE UPDATE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION messages_reject_edit();

-- Row-Level Security: tenant isolation via the schema-safe helper functions.
ALTER TABLE "conversation_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_threads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversation_threads" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

-- Whether a member of the current organization wants new-message emails. notification_preferences rows are
-- self-only (migration 000011), but the sender must know the recipient's opt-in: this returns that one boolean,
-- only for a member of app_current_org(), with the bypass scoped to the function call (restored on exit).
CREATE FUNCTION app_message_email_opt_in(target uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE
  AS $$
  DECLARE
    prior_bypass text := pg_catalog.current_setting('app.bypass_rls', true);
    result boolean;
  BEGIN
    PERFORM pg_catalog.set_config('app.bypass_rls', 'on', true);
    SELECT COALESCE((
      SELECT np.message_email_opt_in FROM notification_preferences np
       WHERE np.user_id = target
         AND EXISTS (SELECT 1 FROM memberships m
                      WHERE m.user_id = target AND m.organization_id = app_current_org())
    ), false) INTO result;
    PERFORM pg_catalog.set_config('app.bypass_rls', COALESCE(prior_bypass, ''), true);
    RETURN result;
  END
  $$;
