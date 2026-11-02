-- PRD K1-K6, K15 (D-013 #1-#6, #10): coaches take payments from their clients. Money is integer minor units in one
-- ISO 4217 currency per workspace. Card payments come from provider webhooks, stored once by event id before they
-- are applied; manual payments (cash, bank transfer) are recorded by a coach. Every table is tenant-owned with forced
-- RLS and composite tenant FKs.

ALTER TABLE "organizations" ADD COLUMN "currency" TEXT;
ALTER TABLE "organizations" ADD COLUMN "payment_grace_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "organizations" ADD COLUMN "renewal_notice_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "organizations" ADD COLUMN "tax_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN "tax_rate_bp" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "tax_home_region" TEXT;
ALTER TABLE "organizations" ADD COLUMN "stripe_tax_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "receipt_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_payments_check" CHECK (
  ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
  AND "payment_grace_days" BETWEEN 0 AND 30
  AND "renewal_notice_days" BETWEEN 1 AND 30
  AND ("tax_id" IS NULL OR length("tax_id") BETWEEN 1 AND 40)
  AND ("tax_rate_bp" IS NULL OR "tax_rate_bp" BETWEEN 0 AND 5000)
  AND ("tax_home_region" IS NULL OR length("tax_home_region") BETWEEN 1 AND 60)
  AND "receipt_seq" >= 0
);

CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "token_ciphertext" TEXT,
    "connected_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_accounts_provider_account_ref_key" ON "payment_accounts"("provider", "account_ref");
CREATE UNIQUE INDEX "payment_accounts_one_active_per_org" ON "payment_accounts"("organization_id") WHERE "status" = 'active';
CREATE INDEX "payment_accounts_organization_id_idx" ON "payment_accounts"("organization_id");
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_check" CHECK (
  "provider" IN ('stripe', 'razorpay', 'fake')
  AND "status" IN ('active', 'disconnected')
  AND length("account_ref") BETWEEN 1 AND 200
);

CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "interval_unit" TEXT,
    "interval_count" INTEGER,
    "installments" INTEGER,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "access_days" INTEGER,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tag_id" UUID,
    "template_program_id" UUID,
    "session_credits" INTEGER,
    "credits_valid_days" INTEGER,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "packages_id_organization_id_key" ON "packages"("id", "organization_id");
CREATE INDEX "packages_organization_id_active_idx" ON "packages"("organization_id", "active");
ALTER TABLE "packages" ADD CONSTRAINT "packages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packages" ADD CONSTRAINT "packages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packages" ADD CONSTRAINT "packages_tag_id_organization_id_fkey" FOREIGN KEY ("tag_id", "organization_id") REFERENCES "client_tags"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packages" ADD CONSTRAINT "packages_template_program_id_organization_id_fkey" FOREIGN KEY ("template_program_id", "organization_id") REFERENCES "programs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packages" ADD CONSTRAINT "packages_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("description") <= 2000
  AND "kind" IN ('one_off', 'recurring', 'plan')
  AND "amount_minor" BETWEEN 1 AND 100000000
  AND (
    ("kind" = 'one_off' AND "interval_unit" IS NULL AND "interval_count" IS NULL AND "installments" IS NULL)
    OR ("kind" = 'recurring' AND "interval_unit" IN ('week', 'month') AND "interval_count" BETWEEN 1 AND 12 AND "installments" IS NULL)
    OR ("kind" = 'plan' AND "interval_unit" IN ('week', 'month') AND "interval_count" BETWEEN 1 AND 12 AND "installments" BETWEEN 2 AND 24)
  )
  AND "trial_days" BETWEEN 0 AND 90
  AND ("access_days" IS NULL OR ("kind" = 'one_off' AND "access_days" BETWEEN 1 AND 730))
  AND ("session_credits" IS NULL OR "session_credits" BETWEEN 1 AND 500)
  AND ("credits_valid_days" IS NULL OR ("session_credits" IS NOT NULL AND "credits_valid_days" BETWEEN 1 AND 730))
);

CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "max_uses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "coupons_id_organization_id_key" ON "coupons"("id", "organization_id");
CREATE UNIQUE INDEX "coupons_organization_id_code_key" ON "coupons"("organization_id", "code");
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_check" CHECK (
  "code" ~ '^[A-Z0-9][A-Z0-9_-]{2,29}$'
  AND (("kind" = 'percent' AND "value" BETWEEN 1 AND 100) OR ("kind" = 'fixed' AND "value" BETWEEN 1 AND 100000000))
  AND ("max_uses" IS NULL OR "max_uses" BETWEEN 1 AND 100000)
  AND "uses" >= 0 AND ("max_uses" IS NULL OR "uses" <= "max_uses")
);

CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "client_id" UUID,
    "buyer_name" TEXT,
    "buyer_email" TEXT,
    "buyer_region" TEXT,
    "provider" TEXT NOT NULL,
    "checkout_ref" TEXT,
    "subscription_ref" TEXT,
    "customer_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currency" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "first_charge_minor" INTEGER NOT NULL,
    "coupon_id" UUID,
    "installments_paid" INTEGER NOT NULL DEFAULT 0,
    "current_period_end" TIMESTAMPTZ(3),
    "access_ends_at" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "past_due_since" TIMESTAMPTZ(3),
    "gate_lifted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchases_id_organization_id_key" ON "purchases"("id", "organization_id");
CREATE UNIQUE INDEX "purchases_provider_checkout_ref_key" ON "purchases"("provider", "checkout_ref");
CREATE UNIQUE INDEX "purchases_provider_subscription_ref_key" ON "purchases"("provider", "subscription_ref");
CREATE INDEX "purchases_organization_id_client_id_idx" ON "purchases"("organization_id", "client_id");
CREATE INDEX "purchases_organization_id_status_idx" ON "purchases"("organization_id", "status");
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_package_id_organization_id_fkey" FOREIGN KEY ("package_id", "organization_id") REFERENCES "packages"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_coupon_id_organization_id_fkey" FOREIGN KEY ("coupon_id", "organization_id") REFERENCES "coupons"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_check" CHECK (
  "provider" IN ('stripe', 'razorpay', 'fake', 'manual')
  AND "status" IN ('pending', 'trialing', 'active', 'past_due', 'canceled', 'ended', 'expired')
  AND ("status" IN ('pending', 'expired') OR "client_id" IS NOT NULL)
  AND "currency" ~ '^[A-Z]{3}$'
  AND "amount_minor" >= 1 AND "first_charge_minor" >= 0 AND "first_charge_minor" <= "amount_minor"
  AND "installments_paid" >= 0
  AND ("buyer_name" IS NULL OR length("buyer_name") BETWEEN 1 AND 120)
  AND ("buyer_email" IS NULL OR length("buyer_email") BETWEEN 3 AND 320)
  AND ("buyer_region" IS NULL OR length("buyer_region") BETWEEN 1 AND 60)
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "receipt_no" INTEGER,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "failure_code" TEXT,
    "note" TEXT,
    "void_reason" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");
CREATE UNIQUE INDEX "payments_organization_id_receipt_no_key" ON "payments"("organization_id", "receipt_no");
CREATE INDEX "payments_organization_id_paid_at_idx" ON "payments"("organization_id", "paid_at");
CREATE INDEX "payments_organization_id_purchase_id_idx" ON "payments"("organization_id", "purchase_id");
CREATE INDEX "payments_organization_id_client_id_idx" ON "payments"("organization_id", "client_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchase_id_organization_id_fkey" FOREIGN KEY ("purchase_id", "organization_id") REFERENCES "purchases"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_check" CHECK (
  "provider" IN ('stripe', 'razorpay', 'fake', 'manual')
  AND "status" IN ('succeeded', 'failed', 'refunded', 'void')
  AND "method" IN ('card', 'upi', 'bank', 'cash', 'other')
  AND "currency" ~ '^[A-Z]{3}$'
  AND "amount_minor" >= 0 AND "tax_minor" >= 0 AND "tax_minor" <= "amount_minor"
  AND "refunded_minor" >= 0 AND "refunded_minor" <= "amount_minor"
  AND ("receipt_no" IS NULL OR "receipt_no" >= 1)
  AND ("status" <> 'succeeded' OR "receipt_no" IS NOT NULL OR "provider" = 'manual')
  AND ("provider" = 'manual' OR "provider_ref" IS NOT NULL)
  AND ("note" IS NULL OR length("note") <= 500)
  AND ("void_reason" IS NULL OR length("void_reason") BETWEEN 1 AND 500)
  AND ("failure_code" IS NULL OR length("failure_code") <= 80)
);

CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider", "event_id");
CREATE INDEX "payment_events_organization_id_idx" ON "payment_events"("organization_id");
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_check" CHECK (
  "provider" IN ('stripe', 'razorpay', 'fake') AND length("event_id") BETWEEN 1 AND 200 AND length("type") BETWEEN 1 AND 80
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_accounts', 'packages', 'coupons', 'purchases', 'payments', 'payment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;

-- A webhook names a connected account, never a workspace Repsy would trust: resolve it here (active accounts only,
-- the id only), the way app_org_by_public_slug resolves a public page (D-012 #13, D-013 #3).
DO $do$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE FUNCTION %1$I.app_org_by_payment_account(p_provider text, p_ref text)
      RETURNS uuid
      LANGUAGE sql STABLE
      SET app.bypass_rls = 'on'
      SET search_path = %1$I, pg_temp
      AS $body$
        SELECT a.organization_id FROM %1$I.payment_accounts a
         WHERE a.provider OPERATOR(pg_catalog.=) p_provider
           AND a.account_ref OPERATOR(pg_catalog.=) p_ref
           AND a.status OPERATOR(pg_catalog.=) 'active'
      $body$
  $f$, pg_catalog.current_schema());
END
$do$;

ALTER TYPE "review_rule" ADD VALUE 'payment_failed';
ALTER TYPE "review_rule" ADD VALUE 'ready_to_assign';
ALTER TYPE "review_rule" ADD VALUE 'package_renewal';
