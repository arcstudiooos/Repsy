-- PRD K1-K9, K15: packages, coupons, subscriptions, payments and receipts.
-- One payments port (Stripe Connect / Razorpay) sits behind these tables; no
-- provider SDK or key is involved. Money is integer minor units (cents/paise)
-- with a currency code. The platform fee is 0% in year one (processor fees only).
-- The journeys slice (J4/J6) reads billing_packages.onboarding_sequence and
-- renewal_reminder_days; it does not own them.
CREATE TABLE "billing_packages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "interval" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "installments" INTEGER,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "onboarding_sequence" JSONB,
    "renewal_reminder_days" INTEGER NOT NULL DEFAULT 3,
    "invite_on_purchase" BOOLEAN NOT NULL DEFAULT false,
    "tags_on_purchase" TEXT[] NOT NULL DEFAULT '{}',
    "template_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_packages_id_organization_id_key" ON "billing_packages"("id", "organization_id");
CREATE INDEX "billing_packages_organization_id_idx" ON "billing_packages"("organization_id");
ALTER TABLE "billing_packages" ADD CONSTRAINT "billing_packages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_packages" ADD CONSTRAINT "billing_packages_check" CHECK (
  length("title") BETWEEN 1 AND 120 AND length("description") <= 2000
  AND "kind" IN ('one_off', 'recurring', 'payment_plan')
  AND ("interval" IS NULL OR "interval" IN ('week', 'month'))
  AND "amount_minor" >= 0 AND "trial_days" BETWEEN 0 AND 365
  AND "renewal_reminder_days" BETWEEN 0 AND 30
  AND ("kind" <> 'recurring' OR "interval" IS NOT NULL)
  AND ("kind" <> 'payment_plan' OR ("installments" BETWEEN 2 AND 24))
  AND ("kind" <> 'one_off' OR "trial_days" = 0)
);

CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "usage_cap" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "coupons_id_organization_id_key" ON "coupons"("id", "organization_id");
CREATE UNIQUE INDEX "coupons_organization_id_code_key" ON "coupons"("organization_id", "code");
CREATE INDEX "coupons_organization_id_idx" ON "coupons"("organization_id");
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_check" CHECK (
  length("code") BETWEEN 3 AND 24 AND "kind" IN ('percentage', 'fixed')
  AND "value" >= 1 AND ("kind" <> 'percentage' OR "value" <= 100)
  AND "used_count" >= 0 AND ("usage_cap" IS NULL OR "usage_cap" >= 1)
);

CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "client_id" UUID,
    "customer_email" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "interval" TEXT,
    "installments" INTEGER,
    "installments_paid" INTEGER NOT NULL DEFAULT 0,
    "trial_ends_at" TIMESTAMPTZ(3),
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "next_charge_at" TIMESTAMPTZ(3),
    "next_retry_at" TIMESTAMPTZ(3),
    "grace_ends_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "coupon_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscriptions_id_organization_id_key" ON "subscriptions"("id", "organization_id");
CREATE INDEX "subscriptions_organization_id_idx" ON "subscriptions"("organization_id");
CREATE INDEX "subscriptions_organization_id_client_id_idx" ON "subscriptions"("organization_id", "client_id");
CREATE INDEX "subscriptions_organization_id_needs_review_idx" ON "subscriptions"("organization_id", "needs_review");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_package_id_organization_id_fkey" FOREIGN KEY ("package_id", "organization_id") REFERENCES "billing_packages"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_coupon_id_organization_id_fkey" FOREIGN KEY ("coupon_id", "organization_id") REFERENCES "coupons"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_check" CHECK (
  "status" IN ('pending', 'trialing', 'active', 'past_due', 'grace', 'paused', 'cancelled', 'ended')
  AND "provider" IN ('stripe', 'razorpay', 'manual')
  AND "amount_minor" >= 0 AND "installments_paid" >= 0 AND "failed_attempts" >= 0
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "package_id" UUID,
    "subscription_id" UUID,
    "client_id" UUID,
    "customer_email" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "provider_charge_id" TEXT,
    "failure_reason" TEXT,
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "coupon_id" UUID,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_id_organization_id_key" ON "payments"("id", "organization_id");
CREATE INDEX "payments_organization_id_idx" ON "payments"("organization_id");
CREATE INDEX "payments_organization_id_client_id_idx" ON "payments"("organization_id", "client_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_organization_id_fkey" FOREIGN KEY ("package_id", "organization_id") REFERENCES "billing_packages"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_organization_id_fkey" FOREIGN KEY ("subscription_id", "organization_id") REFERENCES "subscriptions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_coupon_id_organization_id_fkey" FOREIGN KEY ("coupon_id", "organization_id") REFERENCES "coupons"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_check" CHECK (
  "status" IN ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')
  AND "provider" IN ('stripe', 'razorpay', 'manual')
  AND "kind" IN ('one_off', 'recurring', 'payment_plan', 'manual')
  AND ("method" IS NULL OR "method" IN ('cash', 'bank_transfer'))
  AND "amount_minor" >= 0 AND "tax_minor" >= 0 AND "refunded_minor" >= 0
  AND "refunded_minor" <= "amount_minor"
);

CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "amount_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "receipts_id_organization_id_key" ON "receipts"("id", "organization_id");
CREATE UNIQUE INDEX "receipts_payment_id_organization_id_key" ON "receipts"("payment_id", "organization_id");
CREATE INDEX "receipts_organization_id_idx" ON "receipts"("organization_id");
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_organization_id_fkey" FOREIGN KEY ("payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_check" CHECK (
  "amount_minor" >= 0 AND "tax_minor" >= 0
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_packages', 'coupons', 'subscriptions', 'payments', 'receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
