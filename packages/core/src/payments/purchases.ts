import {
  appendAudit,
  withSystem,
  withTenant,
  type PrismaClient,
  type SystemTx,
  type TenantTx,
} from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { EMAIL, cleanName } from '../clients/clients';
import { canonicalTimezone } from '../timezone';
import { DomainError } from '../errors';
import { emitClientEvent } from '../automations/events';
import { issueInvite } from '../invites/invites';
import { enqueueEmail } from '../outbox';
import { raiseFlag } from '../review/rules';
import { isUuid } from '../uuid';
import { findUsableCoupon, PACKAGE_SELECT, toPackageView, type PackageView } from './catalog';
import { addInterval, discounted } from './money';
import { lapsedSince } from '../lapse/lapse';
import type {
  CheckoutResult,
  ConnectedAccount,
  PaymentEvent,
  PaymentMethod,
  PaymentsPort,
  ProviderName,
  WebhookBatch,
} from './port';

/**
 * PRD K3, K4, K6-K8, K15 (D-013 #2-#10): purchases and payments. Card payments are created by provider webhooks,
 * applied once each; manual payments are recorded by a coach. A purchase becomes real (a client is linked, the
 * invite sent, the tag added, journeys started) when the provider confirms it.
 */
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export type PurchaseStatus =
  'pending' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'ended' | 'expired';
/** Statuses that give the client what they paid for. */
export const LIVE_STATUSES: PurchaseStatus[] = ['trialing', 'active', 'past_due'];

/** Seals and opens stored provider tokens (AES-256-GCM, D-013 #1); supplied by the web layer. */
export interface AccountOpener {
  (row: { provider: string; accountRef: string; tokenCiphertext: string | null }): ConnectedAccount;
}

const plainAccount: AccountOpener = (row) => ({
  provider: row.provider as ProviderName,
  accountRef: row.accountRef,
});

// ---------------------------------------------------------------- the workspace's owner as actor

/** System-side work (webhooks, sweeps) acts as the workspace owner, so every rule and audit applies. */
export async function ownerActor(tx: TenantTx, orgId: string): Promise<ActorContext> {
  const owner = await tx.membership.findFirst({
    where: { role: 'owner', status: 'active' },
    select: { userId: true },
  });
  if (!owner) throw new Error('Workspace has no active owner');
  return { userId: owner.userId, orgId, role: 'owner', isPlatformAdmin: false };
}

// ---------------------------------------------------------------- storefront checkout (K4)

export interface StorefrontPackage extends PackageView {
  currency: string;
}

async function orgBySlug(prisma: PrismaClient, slug: string): Promise<string | null> {
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return null;
  const rows = await (prisma as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<
    { id: string | null }[]
  >`SELECT app_org_by_public_slug(${slug}) AS id`;
  return rows[0]?.id ?? null;
}

/** What the storefront shows: public, active packages, only when payments are set up. */
export async function getStorefront(
  prisma: PrismaClient,
  slug: string,
): Promise<{ packages: StorefrontPackage[]; asksRegion: boolean } | null> {
  const orgId = await orgBySlug(prisma, slug);
  if (!orgId) return null;
  return withTenant(
    orgId,
    async (tx) => {
      const org = await tx.organization.findFirstOrThrow({
        select: {
          currency: true,
          taxRateBp: true,
          taxHomeRegion: true,
          lapsedAt: true,
          plan: true,
          trialEndsAt: true,
        },
      });
      const account = await tx.paymentAccount.findFirst({
        where: { status: 'active' },
        select: { id: true },
      });
      // PRD M12: a lapsed workspace sells nothing.
      if (!org.currency || !account || lapsedSince(org)) return { packages: [], asksRegion: false };
      const rows = await tx.package.findMany({
        where: { active: true, public: true },
        orderBy: { createdAt: 'asc' },
        select: PACKAGE_SELECT,
      });
      return {
        packages: rows.map((r) => ({ ...toPackageView(r), currency: org.currency! })),
        asksRegion: org.taxRateBp !== null && org.taxHomeRegion !== null,
      };
    },
    prisma,
  );
}

export interface CheckoutInput {
  packageId?: unknown;
  name?: unknown;
  email?: unknown;
  region?: unknown;
  coupon?: unknown;
}

/**
 * Starts a hosted checkout for a storefront package (K4). A pending purchase is written first (its id goes to the
 * provider), the provider is asked for a checkout, and its id is stored. A workspace at its client limit takes no new
 * buyers (an existing client of the workspace may still buy). Coupons are checked here and counted only when the
 * payment succeeds (D-013 #5).
 */
export async function startCheckout(
  prisma: PrismaClient,
  slug: string,
  input: CheckoutInput,
  deps: {
    portFor(provider: ProviderName): PaymentsPort;
    openAccount?: AccountOpener;
    /** Absolute URLs; `{purchase}` is replaced with the purchase id. */
    successUrl: string;
    cancelUrl: string;
    now?: Date;
  },
): Promise<CheckoutResult & { purchaseId: string }> {
  const orgId = await orgBySlug(prisma, slug);
  if (!orgId) throw notFound();
  const now = deps.now ?? new Date();
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (name.length < 1 || name.length > 120) throw invalid('name', 'Enter your name.');
  if (!EMAIL.test(email) || email.length > 254) throw invalid('email', 'Enter your email address.');
  const region = typeof input.region === 'string' ? input.region.trim().slice(0, 60) : '';

  const prepared = await withTenant(
    orgId,
    async (tx) => {
      if (!isUuid(input.packageId)) throw notFound();
      const pkg = await tx.package.findFirst({
        where: { id: input.packageId, active: true, public: true },
        select: PACKAGE_SELECT,
      });
      if (!pkg) throw notFound();
      const org = await tx.organization.findFirstOrThrow({
        select: {
          name: true,
          currency: true,
          activeClientLimit: true,
          stripeTaxEnabled: true,
          taxRateBp: true,
          taxHomeRegion: true,
          lapsedAt: true,
          plan: true,
          trialEndsAt: true,
        },
      });
      const accountRow = await tx.paymentAccount.findFirst({
        where: { status: 'active' },
        select: { provider: true, accountRef: true, tokenCiphertext: true },
      });
      if (!org.currency || !accountRow || lapsedSince(org, now)) {
        throw new DomainError('CONFLICT', 'This coach is not taking payments right now.');
      }
      if (org.taxRateBp !== null && org.taxHomeRegion !== null && region === '') {
        throw invalid('region', 'Enter your state or region.');
      }
      // At the client limit the storefront closes for everyone, so the answer never reveals whether an email
      // is already a client (security review F5).
      const counted = await tx.client.count({
        where: { status: { in: ['invited', 'active', 'paused'] } },
      });
      if (counted >= org.activeClientLimit) {
        throw new DomainError('CONFLICT', 'This coach is not taking new clients right now.');
      }
      let coupon: Awaited<ReturnType<typeof findUsableCoupon>> = null;
      if (typeof input.coupon === 'string' && input.coupon.trim() !== '') {
        coupon = await findUsableCoupon(tx, input.coupon, now);
        // The use is reserved now, atomically against the cap, so a single-use code can't be spent by many
        // open checkouts at once; an unfinished checkout gives it back when it expires (security review F2).
        const reserved = coupon
          ? // Same transaction and connection, so the workspace's RLS still applies to this statement.
            await (tx as unknown as Pick<SystemTx, '$executeRaw'>)
              .$executeRaw`UPDATE coupons SET uses = uses + 1
              WHERE id = ${coupon.id}::uuid AND (max_uses IS NULL OR uses < max_uses)`
          : 0;
        if (!coupon || reserved !== 1) throw invalid('coupon', "That code isn't valid.");
      }
      const view = toPackageView(pkg);
      const firstChargeMinor = discounted(view.amountMinor, coupon);
      const purchase = await tx.purchase.create({
        data: {
          packageId: view.id,
          buyerName: cleanName(name),
          buyerEmail: email,
          buyerRegion: region || null,
          provider: accountRow.provider,
          currency: org.currency,
          amountMinor: view.amountMinor,
          firstChargeMinor,
          couponId: coupon?.id ?? null,
        },
      } as Parameters<typeof tx.purchase.create>[0]);
      return {
        purchaseId: purchase.id,
        view,
        org,
        accountRow,
        firstChargeMinor,
      };
    },
    prisma,
  );

  const { view, org, accountRow, purchaseId, firstChargeMinor } = prepared;
  const account = (deps.openAccount ?? plainAccount)(accountRow);
  const port = deps.portFor(account.provider);
  const result = await port.createCheckout({
    account,
    purchaseId,
    currency: org.currency!,
    title: view.title,
    buyerEmail: email,
    mode: view.kind === 'one_off' ? 'payment' : 'subscription',
    firstChargeMinor,
    recurringMinor: view.amountMinor,
    ...(view.intervalUnit && view.intervalCount
      ? { interval: { unit: view.intervalUnit, count: view.intervalCount } }
      : {}),
    ...(view.installments ? { installments: view.installments } : {}),
    trialDays: view.trialDays,
    automaticTax: account.provider === 'stripe' && org.stripeTaxEnabled,
    successUrl: deps.successUrl.replace('{purchase}', purchaseId),
    cancelUrl: deps.cancelUrl.replace('{purchase}', purchaseId),
  });
  await withTenant(
    orgId,
    (tx) =>
      tx.purchase.updateMany({
        where: { id: purchaseId, status: 'pending' },
        data: { checkoutRef: result.checkoutRef },
      }),
    prisma,
  );
  return { ...result, purchaseId };
}

// ---------------------------------------------------------------- activation

type PurchaseRow = {
  id: string;
  packageId: string;
  clientId: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  provider: string;
  status: string;
  couponId: string | null;
  installmentsPaid: number;
  currency: string;
};

/**
 * Makes a confirmed purchase real (D-013 #4): links (or creates) the client by email and invites them unless they are
 * already in, adds the package's tag, and emits `package_purchased` for journeys. A package's template is offered to
 * the coach through the `ready_to_assign` review item once the client is active (rules.ts), never assigned here.
 */
async function linkClient(
  tx: TenantTx,
  orgId: string,
  purchase: PurchaseRow,
  now: Date,
): Promise<string> {
  if (purchase.clientId) return purchase.clientId;
  const actor = await ownerActor(tx, orgId);
  const email = purchase.buyerEmail ?? '';
  const existing = await tx.client.findFirst({
    where: { email },
    select: { id: true, status: true },
  });
  let clientId: string;
  if (existing) {
    clientId = existing.id;
    if (existing.status === 'archived') {
      await tx.client.updateMany({ where: { id: clientId }, data: { status: 'invited' } });
      await issueInvite(tx, actor, clientId, now);
    } else if (existing.status === 'invited') {
      const open = await tx.clientInvite.findFirst({
        where: { clientId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!open) await issueInvite(tx, actor, clientId, now);
    }
  } else {
    // Paid already: the client limit was checked at checkout, so a race past it is accepted (D-013 #4).
    const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
    const created = await tx.client.create({
      data: {
        coachUserId: actor.userId,
        name: purchase.buyerName ?? email,
        email,
        timezone: canonicalTimezone(org.timezone) ?? org.timezone,
      },
    } as Parameters<typeof tx.client.create>[0]);
    clientId = created.id;
    await issueInvite(tx, actor, clientId, now);
  }
  return clientId;
}

async function onActivated(
  tx: TenantTx,
  orgId: string,
  purchaseId: string,
  clientId: string,
  pkg: { id: string; tagId: string | null },
): Promise<void> {
  if (pkg.tagId) {
    await tx.clientTagLink.createMany({
      data: [{ clientId, tagId: pkg.tagId }] as never,
      skipDuplicates: true,
    });
  }
  await emitClientEvent(tx, clientId, 'package_purchased', { packageId: pkg.id, purchaseId });
  await appendAudit(tx, {
    orgId,
    actorId: null,
    objectType: 'purchase',
    objectId: purchaseId,
    action: 'purchase.activated',
    metadata: { clientId, packageId: pkg.id },
  });
}

/** Activates a pending purchase once (a replayed or out-of-order event finds it already done). */
/** K11: a package with session credits makes the purchase a session pack (D-013 #12). */
function creditsFor(
  pkg: { sessionCredits: number | null; creditsValidDays: number | null },
  from: Date,
): { creditsTotal?: number; creditsExpireAt?: Date } {
  if (!pkg.sessionCredits) return {};
  return {
    creditsTotal: pkg.sessionCredits,
    ...(pkg.creditsValidDays
      ? { creditsExpireAt: new Date(from.getTime() + pkg.creditsValidDays * 86_400_000) }
      : {}),
  };
}

async function activate(
  tx: TenantTx,
  orgId: string,
  purchaseId: string,
  refs: { customerRef?: string | null; subscriptionRef?: string | null; trialEnd?: Date | null },
  now: Date,
): Promise<void> {
  // Row lock first, so a checkout event and a payment event racing each other activate once.
  await tx.purchase.updateMany({ where: { id: purchaseId }, data: { updatedAt: now } });
  const p = await tx.purchase.findFirst({ where: { id: purchaseId } });
  if (!p) return;
  const data: Record<string, unknown> = {};
  if (refs.customerRef && !p.customerRef) data.customerRef = refs.customerRef;
  if (refs.subscriptionRef && !p.subscriptionRef) data.subscriptionRef = refs.subscriptionRef;
  // An expired checkout that is paid after all still counts: the money arrived (expireStalePurchases).
  if (p.status !== 'pending' && p.status !== 'expired') {
    if (Object.keys(data).length) await tx.purchase.updateMany({ where: { id: p.id }, data });
    return;
  }
  // Expiry gave the coupon's reserved use back; it was paid for after all, so it counts again.
  if (p.status === 'expired' && p.couponId) {
    await tx.coupon.updateMany({ where: { id: p.couponId }, data: { uses: { increment: 1 } } });
  }
  const pkg = await tx.package.findFirstOrThrow({
    where: { id: p.packageId },
    select: {
      id: true,
      tagId: true,
      accessDays: true,
      kind: true,
      sessionCredits: true,
      creditsValidDays: true,
    },
  });
  const clientId = await linkClient(tx, orgId, p, now);
  data.clientId = clientId;
  data.status = refs.trialEnd ? 'trialing' : 'active';
  if (refs.trialEnd) data.currentPeriodEnd = refs.trialEnd;
  if (pkg.kind === 'one_off' && pkg.accessDays) {
    data.accessEndsAt = new Date(now.getTime() + pkg.accessDays * 86_400_000);
  }
  Object.assign(data, creditsFor(pkg, now));
  await tx.purchase.updateMany({ where: { id: p.id }, data });
  await onActivated(tx, orgId, p.id, clientId, pkg);
}

/** The next gap-free receipt number (D-013 #6): the organization row lock serializes it. */
async function nextReceiptNo(tx: TenantTx, orgId: string): Promise<number> {
  const org = await tx.organization.update({
    where: { id: orgId },
    data: { receiptSeq: { increment: 1 } },
    select: { receiptSeq: true },
  });
  return org.receiptSeq;
}

async function receiptEmail(tx: TenantTx, paymentId: string, clientId: string): Promise<void> {
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { email: true } });
  if (!client) return;
  await enqueueEmail(tx, {
    kind: 'billing',
    toEmail: client.email,
    templateKey: 'payment_receipt',
    payload: { paymentId },
    idempotencyKey: `payment_receipt:${paymentId}`,
  });
}

// ---------------------------------------------------------------- webhooks (D-013 #3)

export interface ApplyResult {
  /** Events applied now (not replays). */
  applied: number;
  /** Follow-up provider calls the caller makes after the transaction (a plan's last instalment). */
  cancelSubscriptions: string[];
}

async function orgByAccount(
  prisma: PrismaClient,
  provider: ProviderName,
  accountRef: string,
): Promise<string | null> {
  const rows = await (prisma as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<
    { id: string | null }[]
  >`SELECT app_org_by_payment_account(${provider}, ${accountRef}) AS id`;
  return rows[0]?.id ?? null;
}

async function purchaseFor(
  tx: TenantTx,
  provider: ProviderName,
  refs: {
    purchaseId?: string | null;
    checkoutRef?: string | null;
    subscriptionRef?: string | null;
  },
) {
  if (refs.subscriptionRef) {
    const p = await tx.purchase.findFirst({
      where: { provider, subscriptionRef: refs.subscriptionRef },
    });
    if (p) return p;
  }
  if (refs.checkoutRef) {
    const p = await tx.purchase.findFirst({ where: { provider, checkoutRef: refs.checkoutRef } });
    if (p) return p;
  }
  if (refs.purchaseId && isUuid(refs.purchaseId)) {
    return tx.purchase.findFirst({ where: { id: refs.purchaseId, provider } });
  }
  return null;
}

async function applyEvent(
  tx: TenantTx,
  orgId: string,
  provider: ProviderName,
  e: PaymentEvent,
  now: Date,
  out: ApplyResult,
): Promise<void> {
  switch (e.type) {
    case 'checkout_completed': {
      const p = await purchaseFor(tx, provider, e);
      if (!p) return;
      await activate(
        tx,
        orgId,
        p.id,
        { customerRef: e.customerRef, subscriptionRef: e.subscriptionRef },
        now,
      );
      return;
    }
    case 'subscription_updated': {
      const p = await purchaseFor(tx, provider, { subscriptionRef: e.subscriptionRef });
      if (!p) return;
      if ((p.status === 'pending' || p.status === 'expired') && e.status === 'trialing') {
        await activate(
          tx,
          orgId,
          p.id,
          { subscriptionRef: e.subscriptionRef, trialEnd: e.periodEnd },
          now,
        );
        return;
      }
      if (p.status === 'ended' || p.status === 'expired') return;
      const data: Record<string, unknown> = {
        cancelAtPeriodEnd: e.cancelAtPeriodEnd,
        ...(e.periodEnd ? { currentPeriodEnd: e.periodEnd } : {}),
      };
      if (e.status === 'past_due' && p.status !== 'past_due') {
        data.status = 'past_due';
        data.pastDueSince = p.pastDueSince ?? now;
      } else if (e.status === 'canceled') {
        data.status = 'canceled';
        data.canceledAt = p.canceledAt ?? now;
      } else if ((e.status === 'active' || e.status === 'trialing') && p.status !== 'pending') {
        data.status = e.status;
        if (e.status === 'active') {
          data.pastDueSince = null;
        }
      }
      if (e.cancelAtPeriodEnd && !p.canceledAt) data.canceledAt = now;
      await tx.purchase.updateMany({ where: { id: p.id }, data });
      return;
    }
    case 'subscription_ended': {
      const p = await purchaseFor(tx, provider, { subscriptionRef: e.subscriptionRef });
      if (!p || p.status === 'ended') return;
      await tx.purchase.updateMany({
        where: { id: p.id },
        data: { status: 'ended', endedAt: e.at, pastDueSince: null },
      });
      if (p.clientId) {
        await emitClientEvent(tx, p.clientId, 'package_ended', {
          packageId: p.packageId,
          purchaseId: p.id,
        });
      }
      return;
    }
    case 'payment_succeeded': {
      const p = await purchaseFor(tx, provider, e);
      if (!p) return;
      if (p.status === 'pending' || p.status === 'expired') {
        await activate(tx, orgId, p.id, { subscriptionRef: e.subscriptionRef }, now);
      }
      const fresh = await tx.purchase.findFirstOrThrow({ where: { id: p.id } });
      if (!fresh.clientId) return;
      const dup = await tx.payment.findFirst({
        where: { provider, providerRef: e.paymentRef },
        select: { id: true },
      });
      if (dup) return;
      const payment = await tx.payment.create({
        data: {
          purchaseId: p.id,
          clientId: fresh.clientId,
          provider,
          providerRef: e.paymentRef,
          status: 'succeeded',
          method: e.method,
          currency: e.currency.toUpperCase(),
          amountMinor: e.amountMinor,
          taxMinor: Math.min(e.taxMinor, e.amountMinor),
          receiptNo: await nextReceiptNo(tx, orgId),
          paidAt: e.paidAt,
        },
      } as Parameters<typeof tx.payment.create>[0]);
      const pkg = await tx.package.findFirstOrThrow({
        where: { id: p.packageId },
        select: { kind: true, installments: true },
      });
      const installmentsPaid = fresh.installmentsPaid + 1;
      await tx.purchase.updateMany({
        where: { id: p.id },
        data: {
          installmentsPaid,
          ...(e.periodEnd ? { currentPeriodEnd: e.periodEnd } : {}),
          ...(['past_due', 'trialing'].includes(fresh.status) ? { status: 'active' } : {}),
          pastDueSince: null,
        },
      });
      // Settles an open "Payment failed" item for this purchase.
      await tx.reviewFlag.updateMany({
        where: {
          ruleKey: 'payment_failed',
          sourceId: p.id,
          state: { in: ['open', 'snoozed'] },
        },
        data: {
          state: 'resolved',
          resolvedAt: now,
          resolvedBy: null,
          resolutionReason: 'Resolved automatically',
          snoozedUntil: null,
        },
      });
      if (
        pkg.kind === 'plan' &&
        pkg.installments !== null &&
        installmentsPaid >= pkg.installments &&
        fresh.subscriptionRef
      ) {
        out.cancelSubscriptions.push(fresh.subscriptionRef);
      }
      await receiptEmail(tx, payment.id, fresh.clientId);
      return;
    }
    case 'payment_failed': {
      const p = await purchaseFor(tx, provider, e);
      if (!p || !p.clientId) return;
      const ref = e.paymentRef ?? `failed:${e.eventId}`;
      const dup = await tx.payment.findFirst({
        where: { provider, providerRef: ref },
        select: { id: true },
      });
      if (!dup) {
        await tx.payment.create({
          data: {
            purchaseId: p.id,
            clientId: p.clientId,
            provider,
            providerRef: ref,
            status: 'failed',
            method: 'card',
            currency: e.currency.toUpperCase(),
            amountMinor: e.amountMinor,
            paidAt: e.at,
            failureCode: e.failureCode ? e.failureCode.slice(0, 80) : null,
          },
        } as Parameters<typeof tx.payment.create>[0]);
      }
      if (p.status === 'ended' || p.status === 'canceled') return;
      const since = p.pastDueSince ?? e.at;
      await tx.purchase.updateMany({
        where: { id: p.id },
        data: { status: 'past_due', pastDueSince: since },
      });
      const raised = await raiseFlag(tx, {
        clientId: p.clientId,
        ruleKey: 'payment_failed',
        sourceType: 'client',
        sourceId: p.id,
        dedupeKey: `payment_failed:${p.id}:${since.toISOString()}`,
        evidence: { purchaseId: p.id },
      });
      if (raised) {
        const client = await tx.client.findFirst({
          where: { id: p.clientId },
          select: { email: true },
        });
        if (client) {
          await enqueueEmail(tx, {
            kind: 'billing',
            toEmail: client.email,
            templateKey: 'payment_failed',
            payload: {},
            idempotencyKey: `payment_failed:${p.id}:${since.toISOString()}`,
          });
        }
      }
      return;
    }
    case 'refunded': {
      const pay = await tx.payment.findFirst({ where: { provider, providerRef: e.paymentRef } });
      if (!pay) return;
      const refunded = Math.min(pay.amountMinor, Math.max(pay.refundedMinor, e.refundedMinor));
      await tx.payment.updateMany({
        where: { id: pay.id },
        data: {
          refundedMinor: refunded,
          ...(refunded >= pay.amountMinor ? { status: 'refunded' } : {}),
        },
      });
      return;
    }
  }
}

/**
 * Applies a verified webhook batch (D-013 #3). The connected account resolves the workspace; each event is stored by
 * its provider id first, and a replay (same id) does nothing. An unknown account is ignored (the provider is told
 * it was received, so it stops retrying).
 */
export async function applyWebhook(
  prisma: PrismaClient,
  provider: ProviderName,
  batch: WebhookBatch,
  now: Date = new Date(),
): Promise<ApplyResult & { orgId: string | null }> {
  const out: ApplyResult = { applied: 0, cancelSubscriptions: [] };
  const orgId = await orgByAccount(prisma, provider, batch.accountRef);
  if (!orgId) return { ...out, orgId: null };
  for (const e of batch.events) {
    await withTenant(
      orgId,
      async (tx) => {
        const { count } = await tx.paymentEvent.createMany({
          data: [{ provider, eventId: e.eventId, type: e.type }] as never,
          skipDuplicates: true,
        });
        if (count === 0) return;
        await applyEvent(tx, orgId, provider, e, now, out);
        out.applied++;
      },
      prisma,
    );
  }
  return { ...out, orgId };
}

// ---------------------------------------------------------------- manual payments (K15)

export type ManualMethod = 'cash' | 'bank' | 'other';
const MANUAL_METHODS: ManualMethod[] = ['cash', 'bank', 'other'];

/**
 * Records a cash, bank-transfer or other payment (K15). Without `purchaseId` it starts a manual purchase of the
 * package (active at once, with the same tag and journeys as a card purchase); with one, it adds a payment to that
 * manual purchase and moves its paid period on. Gets a receipt number like any payment.
 */
export async function recordManualPayment(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    clientId?: unknown;
    packageId?: unknown;
    purchaseId?: unknown;
    amountMinor?: unknown;
    method?: unknown;
    paidAt?: unknown;
    note?: unknown;
  },
  opts: { requestId?: string; now?: Date } = {},
): Promise<{ purchaseId: string; paymentId: string; receiptNo: number }> {
  assertCan(actor, 'billing:record');
  const now = opts.now ?? new Date();
  if (!isUuid(input.clientId)) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: input.clientId, status: { not: 'archived' } },
    select: { id: true },
  });
  if (!client) throw notFound();
  const method = input.method as ManualMethod;
  if (!MANUAL_METHODS.includes(method)) throw invalid('method', 'Pick how it was paid.');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  let paidAt = now;
  if (input.paidAt !== undefined && input.paidAt !== null && input.paidAt !== '') {
    const d = new Date(String(input.paidAt));
    if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000) {
      throw invalid('paidAt', 'Pick the day it was paid (not in the future).');
    }
    paidAt = d;
  }
  const org = await tx.organization.findFirstOrThrow({ select: { currency: true } });
  if (!org.currency)
    throw new DomainError('CONFLICT', 'Set your currency in payment settings first.');

  let purchaseId: string;
  let pkg: {
    id: string;
    tagId: string | null;
    kind: string;
    amountMinor: number;
    intervalUnit: string | null;
    intervalCount: number | null;
    accessDays: number | null;
    sessionCredits: number | null;
    creditsValidDays: number | null;
  };
  let isNew = false;
  if (input.purchaseId !== undefined && input.purchaseId !== null && input.purchaseId !== '') {
    if (!isUuid(input.purchaseId)) throw notFound();
    const p = await tx.purchase.findFirst({
      where: { id: input.purchaseId, clientId: client.id, provider: 'manual' },
    });
    if (!p) throw notFound();
    purchaseId = p.id;
    pkg = await tx.package.findFirstOrThrow({
      where: { id: p.packageId },
      select: {
        id: true,
        tagId: true,
        kind: true,
        amountMinor: true,
        intervalUnit: true,
        intervalCount: true,
        accessDays: true,
        sessionCredits: true,
        creditsValidDays: true,
      },
    });
  } else {
    if (!isUuid(input.packageId)) throw invalid('packageId', 'Pick a package.');
    const found = await tx.package.findFirst({
      where: { id: input.packageId },
      select: {
        id: true,
        tagId: true,
        kind: true,
        amountMinor: true,
        intervalUnit: true,
        intervalCount: true,
        accessDays: true,
        sessionCredits: true,
        creditsValidDays: true,
      },
    });
    if (!found) throw invalid('packageId', 'Pick a package.');
    pkg = found;
    isNew = true;
    const created = await tx.purchase.create({
      data: {
        packageId: pkg.id,
        clientId: client.id,
        provider: 'manual',
        status: 'active',
        currency: org.currency,
        amountMinor: pkg.amountMinor,
        firstChargeMinor: pkg.amountMinor,
        createdBy: actor.userId,
        ...(pkg.kind === 'one_off' && pkg.accessDays
          ? { accessEndsAt: new Date(paidAt.getTime() + pkg.accessDays * 86_400_000) }
          : {}),
        ...creditsFor(pkg, paidAt),
      },
    } as Parameters<typeof tx.purchase.create>[0]);
    purchaseId = created.id;
  }
  const amountMinor =
    input.amountMinor === undefined || input.amountMinor === null || input.amountMinor === ''
      ? pkg.amountMinor
      : Number(input.amountMinor);
  if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > 100_000_000) {
    throw invalid('amountMinor', 'Enter the amount paid.');
  }
  const receiptNo = await nextReceiptNo(tx, actor.orgId);
  const payment = await tx.payment.create({
    data: {
      purchaseId,
      clientId: client.id,
      provider: 'manual',
      status: 'succeeded',
      method,
      currency: org.currency,
      amountMinor,
      receiptNo,
      paidAt,
      note: note || null,
      recordedBy: actor.userId,
    },
  } as Parameters<typeof tx.payment.create>[0]);
  const current = await tx.purchase.findFirstOrThrow({ where: { id: purchaseId } });
  const periodBase =
    current.currentPeriodEnd && current.currentPeriodEnd > paidAt
      ? current.currentPeriodEnd
      : paidAt;
  await tx.purchase.updateMany({
    where: { id: purchaseId },
    data: {
      installmentsPaid: { increment: 1 },
      status: 'active',
      pastDueSince: null,
      ...(pkg.intervalUnit && pkg.intervalCount
        ? {
            currentPeriodEnd: addInterval(
              periodBase,
              pkg.intervalUnit as 'week' | 'month',
              pkg.intervalCount,
            ),
          }
        : {}),
    },
  });
  if (isNew) await onActivated(tx, actor.orgId, purchaseId, client.id, pkg);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'payment',
    objectId: payment.id,
    action: 'payment.recorded',
    metadata: { purchaseId, clientId: client.id, method },
    requestId: opts.requestId,
  });
  return { purchaseId, paymentId: payment.id, receiptNo };
}

/** Voids a manual payment with a reason (D-013 #10): kept, never edited, left out of revenue. */
export async function voidManualPayment(
  tx: TenantTx,
  actor: ActorContext,
  paymentId: string,
  reason: unknown,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'billing:manage');
  if (!isUuid(paymentId)) throw notFound();
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < 1 || r.length > 500) throw invalid('reason', 'Say why it is voided.');
  const { count } = await tx.payment.updateMany({
    where: { id: paymentId, provider: 'manual', status: 'succeeded' },
    data: { status: 'void', voidReason: r },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'payment',
    objectId: paymentId,
    action: 'payment.voided',
    requestId: opts.requestId,
  });
}

// ---------------------------------------------------------------- cancel and refund (K8)

/**
 * Cancels a purchase (K8). A client cancels their own at the period end in one click, and sees the end date at once;
 * a manager may also cancel now. Subscriptions are cancelled with the provider inside this transaction, so a provider
 * error leaves nothing half-done. A one-off or manual purchase simply stops renewing (manual) or ends now.
 */
export async function cancelPurchase(
  tx: TenantTx,
  actor: ActorContext,
  purchaseId: string,
  input: { now?: boolean },
  deps: {
    portFor(provider: ProviderName): PaymentsPort;
    openAccount?: AccountOpener;
    now?: Date;
    requestId?: string;
  },
): Promise<{ status: PurchaseStatus; endsAt: string | null }> {
  if (actor.role === 'client') assertCan(actor, 'billing:self');
  else assertCan(actor, 'billing:manage');
  if (!isUuid(purchaseId)) throw notFound();
  const immediate = input.now === true && actor.role !== 'client';
  const now = deps.now ?? new Date();
  await tx.purchase.updateMany({
    where: {
      id: purchaseId,
      ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
    },
    data: { updatedAt: now },
  });
  const p = await tx.purchase.findFirst({
    where: {
      id: purchaseId,
      ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
    },
  });
  if (!p || !p.clientId) throw notFound();
  if (!LIVE_STATUSES.includes(p.status as PurchaseStatus)) {
    throw new DomainError('CONFLICT', 'This purchase has already ended.');
  }
  if (p.subscriptionRef && p.provider !== 'manual') {
    const row = await tx.paymentAccount.findFirst({
      where: { provider: p.provider, status: 'active' },
      select: { provider: true, accountRef: true, tokenCiphertext: true },
    });
    if (!row) throw new DomainError('CONFLICT', 'The payment account is disconnected.');
    const account = (deps.openAccount ?? plainAccount)(row);
    await deps.portFor(account.provider).cancelSubscription(account, p.subscriptionRef, !immediate);
  }
  const endsAt = immediate ? now : (p.currentPeriodEnd ?? p.accessEndsAt ?? now);
  const ended = immediate || endsAt <= now;
  await tx.purchase.updateMany({
    where: { id: p.id },
    data: ended
      ? {
          status: 'ended',
          endedAt: now,
          canceledAt: now,
          cancelAtPeriodEnd: false,
          pastDueSince: null,
        }
      : { status: 'canceled', canceledAt: now, cancelAtPeriodEnd: true },
  });
  if (ended) {
    await emitClientEvent(tx, p.clientId, 'package_ended', {
      packageId: p.packageId,
      purchaseId: p.id,
    });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'purchase',
    objectId: p.id,
    action: 'purchase.canceled',
    metadata: { byClient: actor.role === 'client', immediate: ended },
    requestId: deps.requestId,
  });
  return { status: ended ? 'ended' : 'canceled', endsAt: endsAt.toISOString() };
}

/** Refunds all or part of a card payment through the provider (managers only); the webhook confirms it. */
export async function refundPayment(
  tx: TenantTx,
  actor: ActorContext,
  paymentId: string,
  input: { amountMinor?: unknown },
  deps: {
    portFor(provider: ProviderName): PaymentsPort;
    openAccount?: AccountOpener;
    requestId?: string;
  },
): Promise<{ refundedMinor: number }> {
  assertCan(actor, 'billing:manage');
  if (!isUuid(paymentId)) throw notFound();
  const pay = await tx.payment.findFirst({ where: { id: paymentId, status: 'succeeded' } });
  if (!pay || pay.provider === 'manual' || !pay.providerRef) throw notFound();
  const left = pay.amountMinor - pay.refundedMinor;
  const amount =
    input.amountMinor === undefined || input.amountMinor === null || input.amountMinor === ''
      ? left
      : Number(input.amountMinor);
  if (!Number.isInteger(amount) || amount < 1 || amount > left) {
    throw invalid('amountMinor', 'Enter an amount up to what is left to refund.');
  }
  const row = await tx.paymentAccount.findFirst({
    where: { provider: pay.provider, status: 'active' },
    select: { provider: true, accountRef: true, tokenCiphertext: true },
  });
  if (!row) throw new DomainError('CONFLICT', 'The payment account is disconnected.');
  const account = (deps.openAccount ?? plainAccount)(row);
  await deps.portFor(account.provider).refund(account, pay.providerRef, amount);
  const refundedMinor = pay.refundedMinor + amount;
  await tx.payment.updateMany({
    where: { id: pay.id },
    data: { refundedMinor, ...(refundedMinor >= pay.amountMinor ? { status: 'refunded' } : {}) },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'payment',
    objectId: pay.id,
    action: 'payment.refunded',
    metadata: { amountMinor: amount },
    requestId: deps.requestId,
  });
  return { refundedMinor };
}

// ---------------------------------------------------------------- reads

export interface PurchaseView {
  id: string;
  clientId: string | null;
  clientName: string | null;
  packageId: string;
  packageTitle: string;
  kind: string;
  provider: string;
  status: PurchaseStatus;
  currency: string;
  amountMinor: number;
  intervalUnit: string | null;
  intervalCount: number | null;
  installments: number | null;
  installmentsPaid: number;
  currentPeriodEnd: string | null;
  accessEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  gateLifted: boolean;
  createdAt: string;
}

export interface PaymentView {
  id: string;
  purchaseId: string;
  clientId: string;
  clientName: string;
  packageTitle: string;
  provider: string;
  status: string;
  method: PaymentMethod | 'cash';
  currency: string;
  amountMinor: number;
  taxMinor: number;
  refundedMinor: number;
  receiptNo: number | null;
  paidAt: string;
  failureCode: string | null;
  note: string | null;
  voidReason: string | null;
}

/** Purchases: a client's own, or (staff) one client's or the whole workspace's, newest first. */
export async function listPurchases(
  tx: TenantTx,
  actor: ActorContext,
  query: { clientId?: string; status?: PurchaseStatus[] } = {},
): Promise<PurchaseView[]> {
  let clientId: string | undefined;
  if (actor.role === 'client') {
    assertCan(actor, 'billing:self');
    if (!actor.clientId) throw notFound();
    clientId = actor.clientId;
  } else {
    assertCan(actor, 'billing:read');
    if (query.clientId !== undefined) {
      if (!isUuid(query.clientId)) throw notFound();
      clientId = query.clientId;
    }
  }
  const rows = await tx.purchase.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      status: { in: query.status ?? ['trialing', 'active', 'past_due', 'canceled', 'ended'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      package: {
        select: {
          title: true,
          kind: true,
          intervalUnit: true,
          intervalCount: true,
          installments: true,
        },
      },
      client: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    packageId: r.packageId,
    packageTitle: r.package.title,
    kind: r.package.kind,
    provider: r.provider,
    status: r.status as PurchaseStatus,
    currency: r.currency,
    amountMinor: r.amountMinor,
    intervalUnit: r.package.intervalUnit,
    intervalCount: r.package.intervalCount,
    installments: r.package.installments,
    installmentsPaid: r.installmentsPaid,
    currentPeriodEnd: r.currentPeriodEnd?.toISOString() ?? null,
    accessEndsAt: r.accessEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    pastDueSince: r.pastDueSince?.toISOString() ?? null,
    // Lifted for this past-due episode; a later failure starts a new one (K7).
    gateLifted:
      r.gateLiftedAt !== null && r.pastDueSince !== null && r.gateLiftedAt >= r.pastDueSince,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Payments, newest first: a client's own, or (staff) the workspace's within dates and optionally one client. */
export async function listPayments(
  tx: TenantTx,
  actor: ActorContext,
  query: { clientId?: string; from?: Date; to?: Date; limit?: number } = {},
): Promise<PaymentView[]> {
  let clientId: string | undefined;
  if (actor.role === 'client') {
    assertCan(actor, 'billing:self');
    if (!actor.clientId) throw notFound();
    clientId = actor.clientId;
  } else {
    assertCan(actor, 'billing:read');
    if (query.clientId !== undefined) {
      if (!isUuid(query.clientId)) throw notFound();
      clientId = query.clientId;
    }
  }
  const rows = await tx.payment.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(query.from || query.to
        ? {
            paidAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    take: Math.min(query.limit ?? 200, 5000),
    include: {
      client: { select: { name: true } },
      purchase: { select: { package: { select: { title: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    purchaseId: r.purchaseId,
    clientId: r.clientId,
    clientName: r.client.name,
    packageTitle: r.purchase.package.title,
    provider: r.provider,
    status: r.status,
    method: r.method as PaymentView['method'],
    currency: r.currency,
    amountMinor: r.amountMinor,
    taxMinor: r.taxMinor,
    refundedMinor: r.refundedMinor,
    receiptNo: r.receiptNo,
    paidAt: r.paidAt.toISOString(),
    failureCode: actor.role === 'client' ? null : r.failureCode,
    note: actor.role === 'client' ? null : r.note,
    voidReason: actor.role === 'client' ? null : r.voidReason,
  }));
}

export interface ReceiptView {
  receiptNo: number;
  paidAt: string;
  orgName: string;
  brandAccent: string | null;
  logoUrl: string | null;
  taxId: string | null;
  clientName: string;
  clientEmail: string;
  packageTitle: string;
  method: string;
  currency: string;
  amountMinor: number;
  refundedMinor: number;
  status: string;
  /** Tax included in the amount, split as the workspace's tax rules require (D-013 #6). */
  taxLines: { label: string; amountMinor: number }[];
}

/**
 * A receipt (K6): for the client who paid or the workspace's staff. Tax comes from the provider (Stripe Tax); for
 * GST workspaces it is derived from the rate (prices include it) and split into CGST and SGST when the buyer is in
 * the workspace's home region, otherwise shown as IGST.
 */
export async function getReceipt(
  tx: TenantTx,
  actor: ActorContext,
  paymentId: string,
): Promise<ReceiptView> {
  if (actor.role === 'client') assertCan(actor, 'billing:self');
  else assertCan(actor, 'billing:read');
  if (!isUuid(paymentId)) throw notFound();
  const pay = await tx.payment.findFirst({
    where: {
      id: paymentId,
      receiptNo: { not: null },
      ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
    },
    include: {
      client: { select: { name: true, email: true } },
      purchase: { select: { buyerRegion: true, package: { select: { title: true } } } },
    },
  });
  if (!pay || pay.receiptNo === null) throw notFound();
  const org = await tx.organization.findFirstOrThrow({
    select: {
      name: true,
      brandAccent: true,
      logoUrl: true,
      taxId: true,
      taxRateBp: true,
      taxHomeRegion: true,
    },
  });
  const taxLines: ReceiptView['taxLines'] = [];
  if (pay.taxMinor > 0) {
    taxLines.push({ label: 'Tax', amountMinor: pay.taxMinor });
  } else if (org.taxRateBp && org.taxRateBp > 0 && pay.provider !== 'stripe') {
    const tax = Math.round((pay.amountMinor * org.taxRateBp) / (10_000 + org.taxRateBp));
    const pct = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
    const sameRegion =
      org.taxHomeRegion !== null &&
      pay.purchase.buyerRegion !== null &&
      org.taxHomeRegion.trim().toLowerCase() === pay.purchase.buyerRegion.trim().toLowerCase();
    if (sameRegion) {
      const half = Math.floor(tax / 2);
      taxLines.push({
        label: `CGST ${pct(org.taxRateBp / 2)} (included)`,
        amountMinor: tax - half,
      });
      taxLines.push({ label: `SGST ${pct(org.taxRateBp / 2)} (included)`, amountMinor: half });
    } else {
      taxLines.push({ label: `IGST ${pct(org.taxRateBp)} (included)`, amountMinor: tax });
    }
  }
  return {
    receiptNo: pay.receiptNo,
    paidAt: pay.paidAt.toISOString(),
    orgName: org.name,
    brandAccent: org.brandAccent,
    logoUrl: org.logoUrl,
    taxId: org.taxId,
    clientName: pay.client.name,
    clientEmail: pay.client.email,
    packageTitle: pay.purchase.package.title,
    method: pay.method,
    currency: pay.currency,
    amountMinor: pay.amountMinor,
    refundedMinor: pay.refundedMinor,
    status: pay.status,
    taxLines,
  };
}

/**
 * Development only (the fake provider): what a pending fake checkout is for, looked up by its reference, so the test
 * checkout page builds its webhook from the stored purchase and never from the form (security review F4).
 */
export async function fakeCheckoutDetails(
  checkoutRef: string,
  prisma?: PrismaClient,
): Promise<{
  accountRef: string;
  p: {
    id: string;
    checkoutRef: string | null;
    currency: string;
    firstChargeMinor: number;
    package: {
      kind: string;
      intervalUnit: string | null;
      intervalCount: number | null;
      trialDays: number;
    };
  };
} | null> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(checkoutRef)) return null;
  return withSystem(async (tx) => {
    const p = await tx.purchase.findFirst({
      where: { provider: 'fake', checkoutRef, status: 'pending' },
      select: {
        id: true,
        organizationId: true,
        checkoutRef: true,
        currency: true,
        firstChargeMinor: true,
        package: {
          select: { kind: true, intervalUnit: true, intervalCount: true, trialDays: true },
        },
      },
    });
    if (!p) return null;
    const account = await tx.paymentAccount.findFirst({
      where: { organizationId: p.organizationId, provider: 'fake', status: 'active' },
      select: { accountRef: true },
    });
    return account ? { p, accountRef: account.accountRef } : null;
  }, prisma);
}
