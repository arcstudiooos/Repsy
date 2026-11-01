-- PRD H5: a coach writes a message now and it is sent at a time in the client's time zone. The worker sends due rows
-- through the normal message path (one message per row: the row id is the message's client_message_id), so a retry
-- never sends twice. A sent row keeps the message it became; a cancelled one is kept for the coach's history.
CREATE TABLE "scheduled_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "send_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "message_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "failure" TEXT,
    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "scheduled_messages_organization_id_thread_id_idx" ON "scheduled_messages"("organization_id", "thread_id");
CREATE INDEX "scheduled_messages_due_idx" ON "scheduled_messages"("send_at") WHERE "sent_at" IS NULL AND "cancelled_at" IS NULL;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_thread_id_organization_id_fkey" FOREIGN KEY ("thread_id", "organization_id") REFERENCES "conversation_threads"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_check" CHECK (
  length("body") BETWEEN 1 AND 4000 AND NOT ("sent_at" IS NOT NULL AND "cancelled_at" IS NOT NULL)
);

ALTER TABLE "scheduled_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scheduled_messages" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
