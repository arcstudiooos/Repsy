import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  billingManageUrl,
  cancelPurchase,
  connectPaymentAccount,
  createCoupon,
  DomainError,
  disconnectPaymentAccount,
  getPaymentSettings,
  getReceipt,
  getRevenue,
  liftPaymentGate,
  listCoupons,
  listPackages,
  listPayments,
  listPurchases,
  minorDigits,
  recordManualPayment,
  revenueCsv,
  refundPayment,
  savePackage,
  setCouponActive,
  setPackageActive,
  updatePaymentSettings,
  voidManualPayment,
  type ProviderName,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { orgCookieSecret } from '../orgCookie';
import {
  appOrigin,
  availableProviders,
  fakePaymentsEnabled,
  paymentDeps,
  razorpayPort,
  sealAccountTokens,
  stripePort,
} from '../payments';

/** PRD K1-K11, K15 (D-013): the coach side of payments. */

export const billingSettingsGetRoute: RouteDef<undefined, true> = {
  can: 'billing:read',
  handler: async ({ actor, tenant }) => ({
    ...(await tenant((tx) => getPaymentSettings(tx, actor))),
    providers: availableProviders(),
  }),
};

const settingsSchema = z.object({
  currency: z.string().max(3).optional(),
  graceDays: z.number().optional(),
  renewalNoticeDays: z.number().optional(),
  taxId: z.string().max(40).nullable().optional(),
  taxRateBp: z.number().nullable().optional(),
  taxHomeRegion: z.string().max(60).nullable().optional(),
  stripeTaxEnabled: z.boolean().optional(),
});

export const billingSettingsPutRoute: RouteDef<typeof settingsSchema, true> = {
  can: 'billing:manage',
  input: settingsSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant((tx) => updatePaymentSettings(tx, actor, input, { requestId })),
};

// ---------------------------------------------------------------- connect (K1, K2)

const STATE_TTL_MS = 15 * 60_000;
const stateMac = (payload: string) =>
  createHmac('sha256', orgCookieSecret()).update(`billing-connect:${payload}`).digest('base64url');

/** OAuth `state`: binds the callback to the user, workspace and provider that started it, for 15 minutes. */
export function signConnectState(
  userId: string,
  orgId: string,
  provider: string,
  now = Date.now(),
): string {
  const payload = `${userId}.${orgId}.${provider}.${now + STATE_TTL_MS}`;
  return `${payload}.${stateMac(payload)}`;
}

export function verifyConnectState(
  state: string,
  userId: string,
  orgId: string,
  provider: string,
  now = Date.now(),
): boolean {
  const i = state.lastIndexOf('.');
  if (i <= 0) return false;
  const payload = state.slice(0, i);
  const given = Buffer.from(state.slice(i + 1), 'base64url');
  const want = Buffer.from(stateMac(payload), 'base64url');
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;
  const [u, o, p, exp] = payload.split('.');
  return u === userId && o === orgId && p === provider && Number(exp) > now;
}

const callbackUrl = (provider: string) =>
  `${appOrigin()}/api/v1/billing/connect/${provider}/callback`;

const providerParam = (p: string | undefined): ProviderName => {
  if (p === 'stripe' || p === 'razorpay' || p === 'fake') return p;
  throw new DomainError('NOT_FOUND', 'Not found.');
};

/** `GET /api/v1/billing/connect/:provider`: starts the provider's OAuth (managers only). */
export const billingConnectStartRoute: RouteDef<undefined, true> = {
  can: 'billing:manage',
  handler: ({ actor, params }) => {
    const provider = providerParam(params.provider);
    const state = signConnectState(actor.userId, actor.orgId, provider);
    const port =
      provider === 'stripe' ? stripePort() : provider === 'razorpay' ? razorpayPort() : null;
    if (!port) throw new DomainError('NOT_FOUND', 'This payment provider is not available.');
    return Response.redirect(port.connectUrl(state, callbackUrl(provider)), 302);
  },
};

const callbackSchema = z.object({
  code: z.string().max(500).optional(),
  state: z.string().max(500).optional(),
  error: z.string().max(200).optional(),
});

/** `GET /api/v1/billing/connect/:provider/callback`: finishes OAuth, then back to the billing page. */
export const billingConnectCallbackRoute: RouteDef<typeof callbackSchema, true> = {
  can: 'billing:manage',
  input: callbackSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    const provider = providerParam(params.provider);
    const back = (status: string) =>
      Response.redirect(`${appOrigin()}/app/billing?connect=${status}`, 302);
    if (input.error || !input.code || !input.state) return back('cancelled');
    if (!verifyConnectState(input.state, actor.userId, actor.orgId, provider))
      return back('expired');
    if (provider === 'stripe') {
      const port = stripePort();
      if (!port) return back('unavailable');
      const { accountRef } = await port.completeConnect(input.code);
      await tenant((tx) =>
        connectPaymentAccount(tx, actor, { provider, accountRef }, { requestId }),
      );
    } else if (provider === 'razorpay') {
      const port = razorpayPort();
      if (!port) return back('unavailable');
      const t = await port.completeConnect(input.code, callbackUrl(provider));
      const tokenCiphertext = sealAccountTokens(provider, t.accountRef, {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: t.expiresAt,
      });
      await tenant((tx) =>
        connectPaymentAccount(
          tx,
          actor,
          { provider, accountRef: t.accountRef, tokenCiphertext },
          { requestId },
        ),
      );
    } else {
      return back('unavailable');
    }
    return back('ok');
  },
};

/** `POST /api/v1/billing/connect/fake`: development only, connects the fake provider (D-013 #1). */
export const billingConnectFakeRoute: RouteDef<undefined, true> = {
  can: 'billing:manage',
  handler: async ({ actor, params, requestId, tenant }) => {
    if (params.provider !== 'fake' || !fakePaymentsEnabled()) {
      throw new DomainError('NOT_FOUND', 'Not found.');
    }
    await tenant((tx) =>
      connectPaymentAccount(
        tx,
        actor,
        { provider: 'fake', accountRef: `acct_fake_${actor.orgId}` },
        { requestId },
      ),
    );
    return new ApiResult(null, { status: 204 });
  },
};

export const billingDisconnectRoute: RouteDef<undefined, true> = {
  can: 'billing:manage',
  handler: async ({ actor, requestId, tenant }) => {
    await tenant((tx) => disconnectPaymentAccount(tx, actor, { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

// ---------------------------------------------------------------- packages and coupons (K3, K5)

const packagesQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

export const packagesGetRoute: RouteDef<typeof packagesQuery, true> = {
  can: 'billing:read',
  input: packagesQuery,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) => listPackages(tx, actor, { includeArchived: input.archived === 'true' })),
};

const packageSchema = z.object({
  title: z.string().max(500),
  description: z.string().max(5000).optional(),
  kind: z.string().max(20),
  amountMinor: z.number(),
  intervalUnit: z.string().max(10).nullable().optional(),
  intervalCount: z.number().nullable().optional(),
  installments: z.number().nullable().optional(),
  trialDays: z.number().nullable().optional(),
  accessDays: z.number().nullable().optional(),
  public: z.boolean().optional(),
  tagId: z.string().max(64).nullable().optional(),
  templateProgramId: z.string().max(64).nullable().optional(),
  sessionCredits: z.number().nullable().optional(),
  creditsValidDays: z.number().nullable().optional(),
});

export const packagesPostRoute: RouteDef<typeof packageSchema, true> = {
  can: 'billing:manage',
  input: packageSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => savePackage(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const packagePutRoute: RouteDef<typeof packageSchema, true> = {
  can: 'billing:manage',
  input: packageSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => savePackage(tx, actor, { ...input, id: params.id ?? '' }, { requestId })),
};

const activeSchema = z.object({ active: z.boolean() });

export const packageActiveRoute: RouteDef<typeof activeSchema, true> = {
  can: 'billing:manage',
  input: activeSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    await tenant((tx) => setPackageActive(tx, actor, params.id ?? '', input.active, { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

export const couponsGetRoute: RouteDef<undefined, true> = {
  can: 'billing:manage',
  handler: ({ actor, tenant }) => tenant((tx) => listCoupons(tx, actor)),
};

const couponSchema = z.object({
  code: z.string().max(60),
  kind: z.string().max(10),
  value: z.number(),
  expiresAt: z.string().max(40).nullable().optional(),
  maxUses: z.number().nullable().optional(),
});

export const couponsPostRoute: RouteDef<typeof couponSchema, true> = {
  can: 'billing:manage',
  input: couponSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => createCoupon(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const couponActiveRoute: RouteDef<typeof activeSchema, true> = {
  can: 'billing:manage',
  input: activeSchema,
  handler: async ({ actor, input, params, tenant }) => {
    await tenant((tx) => setCouponActive(tx, actor, params.id ?? '', input.active));
    return new ApiResult(null, { status: 204 });
  },
};

// ---------------------------------------------------------------- purchases and payments

const listQuery = z.object({
  clientId: z.string().max(64).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

const optDate = (v: string | undefined): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', { from: ['Use a date.'] });
  }
  return d;
};

/** `GET /api/v1/purchases`: a client's own, or (staff) one client's or the workspace's. */
export const purchasesGetRoute: RouteDef<typeof listQuery, true> = {
  input: listQuery,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) => listPurchases(tx, actor, input.clientId ? { clientId: input.clientId } : {})),
};

export const paymentsGetRoute: RouteDef<typeof listQuery, true> = {
  input: listQuery,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) =>
      listPayments(tx, actor, {
        ...(input.clientId ? { clientId: input.clientId } : {}),
        from: optDate(input.from),
        to: optDate(input.to),
      }),
    ),
};

const manualSchema = z.object({
  clientId: z.string().max(64),
  packageId: z.string().max(64).optional(),
  purchaseId: z.string().max(64).optional(),
  amountMinor: z.number().optional(),
  method: z.string().max(20),
  paidAt: z.string().max(40).optional(),
  note: z.string().max(500).optional(),
});

/** `POST /api/v1/payments/manual` (K15): cash, bank transfer or other. */
export const manualPaymentRoute: RouteDef<typeof manualSchema, true> = {
  can: 'billing:record',
  input: manualSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => recordManualPayment(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

const voidSchema = z.object({ reason: z.string().max(500) });

export const paymentVoidRoute: RouteDef<typeof voidSchema, true> = {
  can: 'billing:manage',
  input: voidSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    await tenant((tx) =>
      voidManualPayment(tx, actor, params.id ?? '', input.reason, { requestId }),
    );
    return new ApiResult(null, { status: 204 });
  },
};

const refundSchema = z.object({ amountMinor: z.number().optional() });

export const paymentRefundRoute: RouteDef<typeof refundSchema, true> = {
  can: 'billing:manage',
  input: refundSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => refundPayment(tx, actor, params.id ?? '', input, { ...paymentDeps, requestId })),
};

const cancelSchema = z.object({ now: z.boolean().optional() });

/** `POST /api/v1/purchases/:id/cancel` (K8): a client at the period end; a manager now or then. */
export const purchaseCancelRoute: RouteDef<typeof cancelSchema, true> = {
  input: cancelSchema,
  rateLimit: { capacity: 10, refillPerSecond: 10 / 60 },
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) =>
      cancelPurchase(tx, actor, params.id ?? '', input, { ...paymentDeps, requestId }),
    ),
};

export const receiptGetRoute: RouteDef<undefined, true> = {
  handler: ({ actor, params, tenant }) => tenant((tx) => getReceipt(tx, actor, params.id ?? '')),
};

/** `POST /api/v1/purchases/:id/manage` (K8): the provider's hosted "update card" page, or null when there is none. */
export const purchaseManageRoute: RouteDef<undefined, true> = {
  rateLimit: { capacity: 10, refillPerSecond: 10 / 60 },
  handler: async ({ actor, params, tenant }) => ({
    url: await tenant((tx) =>
      billingManageUrl(tx, actor, params.id ?? '', {
        ...paymentDeps,
        returnUrl: `${appOrigin()}${actor.role === 'client' ? '/portal/billing' : '/app/billing'}`,
      }),
    ),
  }),
};

/** `POST /api/v1/purchases/:id/lift-gate` (K7): lets a past-due client back into the portal for this episode. */
export const purchaseLiftGateRoute: RouteDef<undefined, true> = {
  can: 'billing:record',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => liftPaymentGate(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const revenueQuery = z.object({ format: z.enum(['json', 'csv']).optional() });

/** `GET /api/v1/billing/revenue[?format=csv]` (K9). */
export const revenueGetRoute: RouteDef<typeof revenueQuery, true> = {
  can: 'billing:read',
  input: revenueQuery,
  handler: async ({ actor, input, tenant }) => {
    const r = await tenant((tx) => getRevenue(tx, actor));
    if (input.format !== 'csv') return r;
    return new Response(revenueCsv(r, r.currency ? minorDigits(r.currency) : 2), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="revenue.csv"',
        'cache-control': 'no-store',
      },
    });
  },
};
