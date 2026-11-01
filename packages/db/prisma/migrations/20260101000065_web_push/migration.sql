-- PRD H11, D-011 #6: web push through the portal's service worker. A subscription is one device of one user (user-level,
-- own rows only). Pushes are queued per organization in the same transaction as the event (a message, a reminder)
-- and sent by a worker job; payloads carry no content, so nothing is encrypted or stored but the kind.
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sent_at" TIMESTAMPTZ(3),
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_check" CHECK (
  "endpoint" LIKE 'https://%' AND length("endpoint") <= 1000 AND length("p256dh") <= 200 AND length("auth") <= 100
);

CREATE TABLE "outbox_pushes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    CONSTRAINT "outbox_pushes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outbox_pushes_idempotency_key_key" ON "outbox_pushes"("idempotency_key");
CREATE INDEX "outbox_pushes_organization_id_idx" ON "outbox_pushes"("organization_id");
CREATE INDEX "outbox_pushes_pending_idx" ON "outbox_pushes"("created_at") WHERE "sent_at" IS NULL;
ALTER TABLE "outbox_pushes" ADD CONSTRAINT "outbox_pushes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_pushes" ADD CONSTRAINT "outbox_pushes_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "push_subscriptions" IS 'Users-level (keyed by user_id, not tenant-owned): one browser push subscription per device. Forced RLS: own rows only.';
COMMENT ON TABLE "outbox_pushes" IS 'Tenant-owned: a push to send (kind only, never content). The worker reads it under bypass.';

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY self_row ON "push_subscriptions" FOR ALL
  USING (user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::pg_catalog.uuid OR app_rls_bypass())
  WITH CHECK (user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::pg_catalog.uuid OR app_rls_bypass());

ALTER TABLE "outbox_pushes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_pushes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_pushes" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
