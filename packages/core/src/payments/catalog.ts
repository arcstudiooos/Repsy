import { appendAudit, type Prisma, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { isCurrency, type CouponTerms } from './money';
import type { ProviderName } from './port';

/**
 * PRD K1-K3, K5, K6 (D-013 #1-#6): a workspace's payment settings, its connected provider account, the packages it
 * sells and its coupons. Managers (owner, admin) run all of it; the rest of the team reads packages.
 */
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export interface PaymentSettings {
  currency: string | null;
  graceDays: number;
  renewalNoticeDays: number;
  taxId: string | null;
  /** Percent with two decimals (1800 bp = 18.00%). */
  taxRateBp: number | null;
  taxHomeRegion: string | null;
  stripeTaxEnabled: boolean;
  account: { provider: ProviderName; accountRef: string; connectedAt: string } | null;
}

export async function getPaymentSettings(
  tx: TenantTx,
  actor: ActorContext,
): Promise<PaymentSettings> {
  assertCan(actor, 'billing:read');
  const o = await tx.organization.findFirstOrThrow({
    select: {
      currency: true,
      paymentGraceDays: true,
      renewalNoticeDays: true,
      taxId: true,
      taxRateBp: true,
      taxHomeRegion: true,
      stripeTaxEnabled: true,
    },
  });
  const account = await tx.paymentAccount.findFirst({
    where: { status: 'active' },
    select: { provider: true, accountRef: true, createdAt: true },
  });
  return {
    currency: o.currency,
    graceDays: o.paymentGraceDays,
    renewalNoticeDays: o.renewalNoticeDays,
    taxId: o.taxId,
    taxRateBp: o.taxRateBp,
    taxHomeRegion: o.taxHomeRegion,
    stripeTaxEnabled: o.stripeTaxEnabled,
    account: account
      ? {
          provider: account.provider as ProviderName,
          accountRef: account.accountRef,
          connectedAt: account.createdAt.toISOString(),
        }
      : null,
  };
}

const optText = (v: unknown, field: string, max: number): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw invalid(field, 'Invalid.');
  const t = v.trim();
  if (t.length > max) throw invalid(field, `Use at most ${max} characters.`);
  return t === '' ? null : t;
};
const intIn = (v: unknown, field: string, lo: number, hi: number): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw invalid(field, `Use ${lo}-${hi}.`);
  return n;
};

/** The currency is set once: changing it would make existing prices and payments ambiguous (D-013 #2). */
export async function updatePaymentSettings(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    currency?: unknown;
    graceDays?: unknown;
    renewalNoticeDays?: unknown;
    taxId?: unknown;
    taxRateBp?: unknown;
    taxHomeRegion?: unknown;
    stripeTaxEnabled?: unknown;
  },
  opts: { requestId?: string } = {},
): Promise<PaymentSettings> {
  assertCan(actor, 'billing:manage');
  const current = await tx.organization.findFirstOrThrow({ select: { currency: true } });
  const data: Prisma.OrganizationUpdateManyMutationInput = {};
  if (input.currency !== undefined) {
    const c = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
    if (!isCurrency(c)) throw invalid('currency', 'Pick a currency.');
    if (current.currency && current.currency !== c) {
      throw new DomainError('CONFLICT', 'The currency is set once and can no longer change.');
    }
    data.currency = c;
  }
  if (input.graceDays !== undefined)
    data.paymentGraceDays = intIn(input.graceDays, 'graceDays', 0, 30);
  if (input.renewalNoticeDays !== undefined) {
    data.renewalNoticeDays = intIn(input.renewalNoticeDays, 'renewalNoticeDays', 1, 30);
  }
  if (input.taxId !== undefined) data.taxId = optText(input.taxId, 'taxId', 40);
  if (input.taxRateBp !== undefined) {
    data.taxRateBp = input.taxRateBp === null ? null : intIn(input.taxRateBp, 'taxRateBp', 0, 5000);
  }
  if (input.taxHomeRegion !== undefined) {
    data.taxHomeRegion = optText(input.taxHomeRegion, 'taxHomeRegion', 60);
  }
  if (input.stripeTaxEnabled !== undefined) {
    if (typeof input.stripeTaxEnabled !== 'boolean') throw invalid('stripeTaxEnabled', 'Invalid.');
    data.stripeTaxEnabled = input.stripeTaxEnabled;
  }
  if (Object.keys(data).length > 0) {
    await tx.organization.updateMany({ data });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'organization',
      objectId: actor.orgId,
      action: 'billing.settings_updated',
      metadata: { fields: Object.keys(data).join(',') },
      requestId: opts.requestId,
    });
  }
  return getPaymentSettings(tx, actor);
}

/**
 * Connects a provider account after its OAuth (K1, K2) or, in development, the fake one. One active account per
 * workspace: connecting replaces the previous one. An account already connected to another workspace is refused.
 */
export async function connectPaymentAccount(
  tx: TenantTx,
  actor: ActorContext,
  input: { provider: ProviderName; accountRef: string; tokenCiphertext?: string | null },
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'billing:manage');
  const ref = input.accountRef.trim();
  if (ref.length < 1 || ref.length > 200) throw invalid('accountRef', 'Invalid account.');
  await tx.paymentAccount.updateMany({
    where: { status: 'active' },
    data: { status: 'disconnected', tokenCiphertext: null },
  });
  const existing = await tx.paymentAccount.findFirst({
    where: { provider: input.provider, accountRef: ref },
    select: { id: true },
  });
  if (existing) {
    await tx.paymentAccount.updateMany({
      where: { id: existing.id },
      data: {
        status: 'active',
        tokenCiphertext: input.tokenCiphertext ?? null,
        connectedBy: actor.userId,
      },
    });
  } else {
    try {
      await tx.paymentAccount.create({
        data: {
          provider: input.provider,
          accountRef: ref,
          tokenCiphertext: input.tokenCiphertext ?? null,
          connectedBy: actor.userId,
        },
      } as Parameters<typeof tx.paymentAccount.create>[0]);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new DomainError('CONFLICT', 'This account is connected to another workspace.');
      }
      throw error;
    }
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'organization',
    objectId: actor.orgId,
    action: 'billing.account_connected',
    metadata: { provider: input.provider },
    requestId: opts.requestId,
  });
}

export async function disconnectPaymentAccount(
  tx: TenantTx,
  actor: ActorContext,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'billing:manage');
  const { count } = await tx.paymentAccount.updateMany({
    where: { status: 'active' },
    data: { status: 'disconnected', tokenCiphertext: null },
  });
  if (count > 0) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'organization',
      objectId: actor.orgId,
      action: 'billing.account_disconnected',
      requestId: opts.requestId,
    });
  }
}

// ---------------------------------------------------------------- packages (K3)

export type PackageKind = 'one_off' | 'recurring' | 'plan';
export const PACKAGE_KINDS: readonly PackageKind[] = ['one_off', 'recurring', 'plan'];

export interface PackageView {
  id: string;
  title: string;
  description: string;
  kind: PackageKind;
  amountMinor: number;
  intervalUnit: 'week' | 'month' | null;
  intervalCount: number | null;
  installments: number | null;
  trialDays: number;
  accessDays: number | null;
  public: boolean;
  active: boolean;
  tagId: string | null;
  templateProgramId: string | null;
  sessionCredits: number | null;
  creditsValidDays: number | null;
}

type PackageRow = {
  id: string;
  title: string;
  description: string;
  kind: string;
  amountMinor: number;
  intervalUnit: string | null;
  intervalCount: number | null;
  installments: number | null;
  trialDays: number;
  accessDays: number | null;
  public: boolean;
  active: boolean;
  tagId: string | null;
  templateProgramId: string | null;
  sessionCredits: number | null;
  creditsValidDays: number | null;
};

export const toPackageView = (p: PackageRow): PackageView => ({
  id: p.id,
  title: p.title,
  description: p.description,
  kind: p.kind as PackageKind,
  amountMinor: p.amountMinor,
  intervalUnit: p.intervalUnit as PackageView['intervalUnit'],
  intervalCount: p.intervalCount,
  installments: p.installments,
  trialDays: p.trialDays,
  accessDays: p.accessDays,
  public: p.public,
  active: p.active,
  tagId: p.tagId,
  templateProgramId: p.templateProgramId,
  sessionCredits: p.sessionCredits,
  creditsValidDays: p.creditsValidDays,
});

export const PACKAGE_SELECT = {
  id: true,
  title: true,
  description: true,
  kind: true,
  amountMinor: true,
  intervalUnit: true,
  intervalCount: true,
  installments: true,
  trialDays: true,
  accessDays: true,
  public: true,
  active: true,
  tagId: true,
  templateProgramId: true,
  sessionCredits: true,
  creditsValidDays: true,
} as const;

export async function listPackages(
  tx: TenantTx,
  actor: ActorContext,
  query: { includeArchived?: boolean } = {},
): Promise<PackageView[]> {
  assertCan(actor, 'billing:read');
  const rows = await tx.package.findMany({
    where: query.includeArchived ? {} : { active: true },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    select: PACKAGE_SELECT,
  });
  return rows.map(toPackageView);
}

export interface PackageInput {
  id?: string;
  title?: unknown;
  description?: unknown;
  kind?: unknown;
  amountMinor?: unknown;
  intervalUnit?: unknown;
  intervalCount?: unknown;
  installments?: unknown;
  trialDays?: unknown;
  accessDays?: unknown;
  public?: unknown;
  tagId?: unknown;
  templateProgramId?: unknown;
  sessionCredits?: unknown;
  creditsValidDays?: unknown;
}

const optInt = (v: unknown, field: string, lo: number, hi: number): number | null =>
  v === null || v === undefined || v === '' ? null : intIn(v, field, lo, hi);

/**
 * Creates or replaces a package. Prices apply to new purchases only: a purchase keeps the amount it was bought at
 * (D-013 #2). A package needs the workspace currency to be set.
 */
export async function savePackage(
  tx: TenantTx,
  actor: ActorContext,
  input: PackageInput,
  opts: { requestId?: string } = {},
): Promise<PackageView> {
  assertCan(actor, 'billing:manage');
  const org = await tx.organization.findFirstOrThrow({ select: { currency: true } });
  if (!org.currency) {
    throw new DomainError('CONFLICT', 'Set your currency in payment settings first.');
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > 120) throw invalid('title', 'Use 1-120 characters.');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 2000) throw invalid('description', 'Use at most 2000 characters.');
  const kind = input.kind as PackageKind;
  if (!PACKAGE_KINDS.includes(kind)) throw invalid('kind', 'Pick how it is paid.');
  const amountMinor = intIn(input.amountMinor, 'amountMinor', 1, 100_000_000);
  let intervalUnit: 'week' | 'month' | null = null;
  let intervalCount: number | null = null;
  let installments: number | null = null;
  if (kind !== 'one_off') {
    if (input.intervalUnit !== 'week' && input.intervalUnit !== 'month') {
      throw invalid('intervalUnit', 'Pick weeks or months.');
    }
    intervalUnit = input.intervalUnit;
    intervalCount = intIn(input.intervalCount ?? 1, 'intervalCount', 1, 12);
  }
  if (kind === 'plan') installments = intIn(input.installments, 'installments', 2, 24);
  const trialDays = optInt(input.trialDays, 'trialDays', 0, 90) ?? 0;
  if (trialDays > 0 && kind === 'one_off') {
    throw invalid('trialDays', 'A free trial needs a recurring price or a payment plan.');
  }
  const accessDays = kind === 'one_off' ? optInt(input.accessDays, 'accessDays', 1, 730) : null;
  const sessionCredits = optInt(input.sessionCredits, 'sessionCredits', 1, 500);
  const creditsValidDays =
    sessionCredits === null ? null : optInt(input.creditsValidDays, 'creditsValidDays', 1, 730);

  const tagId =
    input.tagId === null || input.tagId === undefined || input.tagId === '' ? null : input.tagId;
  if (tagId !== null) {
    if (
      !isUuid(tagId) ||
      !(await tx.clientTag.findFirst({ where: { id: tagId }, select: { id: true } }))
    ) {
      throw invalid('tagId', 'Pick a tag.');
    }
  }
  const templateProgramId =
    input.templateProgramId === null ||
    input.templateProgramId === undefined ||
    input.templateProgramId === ''
      ? null
      : input.templateProgramId;
  if (templateProgramId !== null) {
    const program = isUuid(templateProgramId)
      ? await tx.program.findFirst({
          where: { id: templateProgramId, kind: 'template' },
          select: { currentVersionId: true },
        })
      : null;
    if (!program) throw invalid('templateProgramId', 'Pick a program template.');
    if (!program.currentVersionId) {
      throw invalid('templateProgramId', 'Save the program before offering it.');
    }
  }
  const data = {
    title,
    description,
    kind,
    amountMinor,
    intervalUnit,
    intervalCount,
    installments,
    trialDays,
    accessDays,
    public: input.public === true,
    tagId,
    templateProgramId,
    sessionCredits,
    creditsValidDays,
  };
  let row;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await tx.package.updateMany({ where: { id: input.id }, data });
    if (count === 0) throw notFound();
    row = await tx.package.findFirstOrThrow({ where: { id: input.id }, select: PACKAGE_SELECT });
  } else {
    row = await tx.package.create({
      data: { ...data, createdBy: actor.userId },
      select: PACKAGE_SELECT,
    } as Parameters<typeof tx.package.create>[0]);
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'package',
    objectId: row.id,
    action: input.id ? 'package.updated' : 'package.created',
    requestId: opts.requestId,
  });
  return toPackageView(row as PackageRow);
}

/** Archiving stops new purchases; existing purchases run on (D-013 #2). */
export async function setPackageActive(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  active: boolean,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'billing:manage');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.package.updateMany({ where: { id }, data: { active } });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'package',
    objectId: id,
    action: active ? 'package.restored' : 'package.archived',
    requestId: opts.requestId,
  });
}

// ---------------------------------------------------------------- coupons (K5)

export interface CouponView {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
}

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

export async function listCoupons(tx: TenantTx, actor: ActorContext): Promise<CouponView[]> {
  assertCan(actor, 'billing:manage');
  const rows = await tx.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    kind: c.kind as CouponView['kind'],
    value: c.value,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    maxUses: c.maxUses,
    uses: c.uses,
    active: c.active,
  }));
}

export async function createCoupon(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    code?: unknown;
    kind?: unknown;
    value?: unknown;
    expiresAt?: unknown;
    maxUses?: unknown;
  },
  opts: { requestId?: string; now?: Date } = {},
): Promise<CouponView> {
  assertCan(actor, 'billing:manage');
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  if (!CODE.test(code)) throw invalid('code', 'Use 3-30 letters, digits, - or _.');
  if (input.kind !== 'percent' && input.kind !== 'fixed') throw invalid('kind', 'Pick a type.');
  const value =
    input.kind === 'percent'
      ? intIn(input.value, 'value', 1, 100)
      : intIn(input.value, 'value', 1, 100_000_000);
  let expiresAt: Date | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined && input.expiresAt !== '') {
    const d = new Date(String(input.expiresAt));
    if (Number.isNaN(d.getTime())) throw invalid('expiresAt', 'Pick a date.');
    if (d <= (opts.now ?? new Date())) throw invalid('expiresAt', 'Pick a future date.');
    expiresAt = d;
  }
  const maxUses = optInt(input.maxUses, 'maxUses', 1, 100_000);
  try {
    const row = await tx.coupon.create({
      data: { code, kind: input.kind, value, expiresAt, maxUses },
    } as Parameters<typeof tx.coupon.create>[0]);
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'coupon',
      objectId: row.id,
      action: 'coupon.created',
      requestId: opts.requestId,
    });
    return {
      id: row.id,
      code: row.code,
      kind: row.kind as CouponView['kind'],
      value: row.value,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      maxUses: row.maxUses,
      uses: row.uses,
      active: row.active,
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw invalid('code', 'That code already exists.');
    }
    throw error;
  }
}

export async function setCouponActive(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  active: boolean,
): Promise<void> {
  assertCan(actor, 'billing:manage');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.coupon.updateMany({ where: { id }, data: { active } });
  if (count === 0) throw notFound();
}

/** A usable coupon by code, or null (inactive, expired or used up). */
export async function findUsableCoupon(
  tx: TenantTx,
  code: string,
  now: Date,
): Promise<(CouponTerms & { id: string }) | null> {
  const c = await tx.coupon.findFirst({
    where: { code: code.trim().toUpperCase(), active: true },
  });
  if (!c) return null;
  if (c.expiresAt && c.expiresAt <= now) return null;
  if (c.maxUses !== null && c.uses >= c.maxUses) return null;
  return { id: c.id, kind: c.kind as CouponTerms['kind'], value: c.value };
}
