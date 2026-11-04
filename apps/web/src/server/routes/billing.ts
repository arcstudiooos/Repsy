import { z } from 'zod';
import {
  archivePackage,
  assertLapseAllows,
  billingCsv,
  cancelSubscription,
  confirmCheckout,
  createCheckout,
  getBillingAnalytics,
  getReceipt,
  handleFailedPayment,
  listPackages,
  listSubscriptions,
  recordManualPayment,
  refundPayment,
  retrySubscriptionPayment,
  saveCoupon,
  savePackage,
  validateCoupon,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/**
 * Billing API (PRD K1-K9, K15). All routes run in `withTenant` through
 * `apiHandler`'s `tenant()` helper. No route here touches a real payments
 * provider: checkout URLs come from the fake provider and are labelled as
 * test checkout in the UI. `confirmCheckout` is a coach-only demo stand-in
 * for a verified provider webhook; a real adapter must call it from a
 * verified webhook, never from a client request.
 *
 * Core exports for these functions are merge inputs: see the export list in
 * SLICE_REPORT_BILLING.md (this slice must not edit packages/core/src/index.ts).
 */

const packageSchema = z.object({
  id: z.string().max(64).optional(),
  title: z.string().max(500),
  description: z.string().max(5000).optional(),
  kind: z.string().max(20),
  interval: z.string().max(20).nullable().optional(),
  amountMinor: z.number(),
  currency: z.string().max(10),
  installments: z.number().nullable().optional(),
  trialDays: z.number().optional(),
  active: z.boolean().optional(),
  onboardingSequence: z.string().max(200).nullable().optional(),
  renewalReminderDays: z.number().optional(),
  inviteOnPurchase: z.boolean().optional(),
  tagsOnPurchase: z.array(z.string().max(80)).optional(),
  templateId: z.string().max(64).nullable().optional(),
});

/** `GET /api/v1/billing/packages` (PRD K3). */
export const billingPackagesGetRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: ({ actor, tenant }) => tenant((tx) => listPackages(tx, actor)),
};

/** `POST /api/v1/billing/packages` (PRD K3, K5 for coupons via /coupons below). */
export const billingPackagesPostRoute: RouteDef<typeof packageSchema, true> = {
  can: 'client:update',
  input: packageSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => savePackage(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

const packageDeleteSchema = z.object({ id: z.string().max(64) });

/** `DELETE /api/v1/billing/packages` with a JSON body `{ id }` archives a package (K3). */
export const billingPackagesDeleteRoute: RouteDef<typeof packageDeleteSchema, true> = {
  can: 'client:update',
  input: packageDeleteSchema,
  handler: async ({ actor, input, tenant }) => {
    await tenant((tx) => archivePackage(tx, actor, input.id));
    return new ApiResult(null, { status: 204 });
  },
};

const couponSchema = z.object({
  id: z.string().max(64).optional(),
  code: z.string().max(24),
  kind: z.string().max(20),
  value: z.number(),
  currency: z.string().max(10).nullable().optional(),
  expiresAt: z.string().max(40).nullable().optional(),
  usageCap: z.number().nullable().optional(),
});

/** `POST /api/v1/billing/packages/coupons` — kept beside packages (PRD K5). */
export const billingCouponsPostRoute: RouteDef<typeof couponSchema, true> = {
  can: 'client:update',
  input: couponSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => saveCoupon(tx, actor, input)), { status: 201 }),
};

const checkoutSchema = z.object({
  packageId: z.string().max(64),
  clientId: z.string().max(64).nullable().optional(),
  customerEmail: z.string().max(320),
  couponCode: z.string().max(24).nullable().optional(),
  provider: z.string().max(20).nullable().optional(),
});

/** `POST /api/v1/billing/checkout` (PRD K4): fake hosted checkout session. */
export const billingCheckoutPostRoute: RouteDef<typeof checkoutSchema, true> = {
  can: 'client:update',
  input: checkoutSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => createCheckout(tx, actor, input)), { status: 201 }),
};

const subscriptionsQuery = z.object({ needsReview: z.string().optional() });

/** `GET /api/v1/billing/subscriptions` (PRD K7 list, K8 coach view). */
export const billingSubscriptionsGetRoute: RouteDef<typeof subscriptionsQuery, true> = {
  can: 'client:update',
  input: subscriptionsQuery,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) => listSubscriptions(tx, actor, { needsReview: input.needsReview === 'true' })),
};

const subscriptionActionSchema = z.object({
  subscriptionId: z.string().max(64),
  action: z.enum(['cancel', 'retry', 'fail']),
  reason: z.string().max(200).optional(),
  graceDays: z.number().optional(),
});

/**
 * `POST /api/v1/billing/subscriptions`: cancel in one click (K8, client or
 * staff), retry a past-due subscription, or record a failure (K7, staff).
 * Exempt from the route-level lapse gate so cancel always works; retry/fail check it in the handler.
 * Route-level `session:log` lets a client reach cancel; core still enforces
 * staff-only writes for retry/fail and scopes cancel to the client's own
 * subscription (see billing.ts `assertBillingWrite`).
 */
export const billingSubscriptionsPostRoute: RouteDef<typeof subscriptionActionSchema, true> = {
  lapse: 'exempt',
  can: 'session:log',
  input: subscriptionActionSchema,
  handler: async ({ actor, input, tenant }) => {
    if (input.action === 'cancel') {
      return tenant((tx) => cancelSubscription(tx, actor, input.subscriptionId));
    }
    // Cancelling stays open after a lapse (M12: no charge a client cannot stop); retry/fail are ordinary writes.
    await tenant((tx) => assertLapseAllows(tx, actor, 'write'));
    if (input.action === 'retry') {
      return tenant((tx) => retrySubscriptionPayment(tx, actor, input.subscriptionId));
    }
    return tenant((tx) =>
      handleFailedPayment(tx, actor, {
        subscriptionId: input.subscriptionId,
        reason: input.reason,
        graceDays: input.graceDays,
      }),
    );
  },
};

const paymentsSchema = z.object({
  action: z.enum(['confirm', 'refund', 'manual']),
  subscriptionId: z.string().max(64).nullable().optional(),
  paymentId: z.string().max(64).nullable().optional(),
  amountMinor: z.number().optional(),
  packageId: z.string().max(64).nullable().optional(),
  clientId: z.string().max(64).nullable().optional(),
  customerEmail: z.string().max(320).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  method: z.string().max(20).nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
});

/**
 * `POST /api/v1/billing/payments`: confirm a test checkout, refund a payment,
 * or record a manual payment (K15). Coach-only; `confirm` is the demo
 * stand-in for a verified webhook (see the file header).
 */
export const billingPaymentsPostRoute: RouteDef<typeof paymentsSchema, true> = {
  can: 'client:update',
  input: paymentsSchema,
  handler: async ({ actor, input, tenant }) => {
    if (input.action === 'confirm') {
      return tenant((tx) =>
        confirmCheckout(tx, actor, {
          subscriptionId: input.subscriptionId ?? undefined,
          paymentId: input.paymentId ?? undefined,
        }),
      );
    }
    if (input.action === 'refund') {
      return tenant((tx) =>
        refundPayment(tx, actor, { paymentId: input.paymentId, amountMinor: input.amountMinor }),
      );
    }
    return tenant((tx) =>
      recordManualPayment(tx, actor, {
        packageId: input.packageId,
        clientId: input.clientId,
        customerEmail: input.customerEmail,
        amountMinor: input.amountMinor,
        currency: input.currency,
        method: input.method,
        reference: input.reference,
      }),
    );
  },
};

const receiptQuery = z.object({ id: z.string().max(64) });

/** `GET /api/v1/billing/receipts?id=…` (PRD K6, K8). */
export const billingReceiptsGetRoute: RouteDef<typeof receiptQuery, true> = {
  can: 'session:read',
  input: receiptQuery,
  handler: ({ actor, input, tenant }) => tenant((tx) => getReceipt(tx, actor, input.id)),
};

const analyticsQuery = z.object({ format: z.string().optional() });

/**
 * `GET /api/v1/billing/analytics` (PRD K9). `?format=csv` returns the CSV
 * export; otherwise the JSON dashboard. Kept beside the billing routes so
 * the revenue page has one fetch; the I7 business page merges it on merge.
 */
export const billingAnalyticsGetRoute: RouteDef<typeof analyticsQuery, true> = {
  can: 'analytics:read',
  input: analyticsQuery,
  handler: async ({ actor, input, tenant }) => {
    const { summary, monthly } = await tenant((tx) => getBillingAnalytics(tx, actor));
    if (input.format === 'csv') {
      return new ApiResult(billingCsv(monthly), {
        headers: {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="revenue.csv"',
        },
      });
    }
    return { summary, monthly };
  },
};

const couponValidateSchema = z.object({
  code: z.string().max(24),
  amountMinor: z.string().max(20),
  currency: z.string().max(10),
});

/** `GET /api/v1/billing/coupons/validate?code=…&amountMinor=…&currency=…` (K5). */
export const billingCouponValidateRoute: RouteDef<typeof couponValidateSchema, true> = {
  can: 'client:update',
  input: couponValidateSchema,
  handler: ({ input, tenant }) =>
    tenant((tx) => validateCoupon(tx, input.code, Number(input.amountMinor), input.currency)),
};
