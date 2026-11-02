import { createHash } from 'node:crypto';
import {
  FakePayments,
  parseSealKey,
  seal,
  unseal,
  type AccountOpener,
  type PaymentsPort,
  type ProviderName,
} from '@kinetic/core';
import { RazorpayPayments } from './razorpay';
import { StripePayments } from './stripe';

/**
 * D-013 #1: which payment providers this deployment can use, from the environment. Stripe and Razorpay switch on
 * only with their keys; the fake provider runs everywhere except production (and can be switched off with
 * FAKE_PAYMENTS=off), so development and E2E take payments without any account.
 */
const env = (k: string) => process.env[k]?.trim() || undefined;

export function appOrigin(): string {
  return (env('APP_BASE_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export function fakePaymentsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && env('FAKE_PAYMENTS') !== 'off';
}

/** The fake provider's webhook secret: its own variable, else derived from the auth secret (dev only). */
export function fakeSecret(): string {
  return (
    env('FAKE_PAYMENTS_SECRET') ??
    createHash('sha256')
      .update(`fake-payments:${env('BETTER_AUTH_SECRET') ?? 'dev'}`)
      .digest('hex')
  );
}

let stripe: StripePayments | null | undefined;
export function stripePort(): StripePayments | null {
  if (stripe !== undefined) return stripe;
  const secretKey = env('STRIPE_SECRET_KEY');
  const webhookSecret = env('STRIPE_WEBHOOK_SECRET');
  const connectClientId = env('STRIPE_CONNECT_CLIENT_ID');
  stripe =
    secretKey && webhookSecret && connectClientId
      ? new StripePayments({ secretKey, webhookSecret, connectClientId })
      : null;
  return stripe;
}

let razorpay: RazorpayPayments | null | undefined;
export function razorpayPort(): RazorpayPayments | null {
  if (razorpay !== undefined) return razorpay;
  const clientId = env('RAZORPAY_CLIENT_ID');
  const clientSecret = env('RAZORPAY_CLIENT_SECRET');
  const webhookSecret = env('RAZORPAY_WEBHOOK_SECRET');
  razorpay =
    clientId && clientSecret && webhookSecret
      ? new RazorpayPayments({ clientId, clientSecret, webhookSecret })
      : null;
  return razorpay;
}

let fake: FakePayments | undefined;
export function fakePort(): FakePayments | null {
  if (!fakePaymentsEnabled()) return null;
  fake ??= new FakePayments(fakeSecret(), appOrigin());
  return fake;
}

/** The providers a workspace can connect here, in the order the settings page offers them. */
export function availableProviders(): ProviderName[] {
  return [
    ...(stripePort() ? (['stripe'] as const) : []),
    ...(razorpayPort() ? (['razorpay'] as const) : []),
    ...(fakePaymentsEnabled() ? (['fake'] as const) : []),
  ];
}

export function portFor(provider: ProviderName): PaymentsPort {
  const port =
    provider === 'stripe' ? stripePort() : provider === 'razorpay' ? razorpayPort() : fakePort();
  if (!port) throw new Error(`Payment provider ${provider} is not configured`);
  return port;
}

const tokenContext = (provider: string, accountRef: string) => `payments:${provider}:${accountRef}`;

/** Seals a provider's OAuth tokens for storage (Razorpay); PROVIDER_TOKEN_KEY is required for it. */
export function sealAccountTokens(
  provider: ProviderName,
  accountRef: string,
  tokens: object,
): string {
  return seal(
    parseSealKey(env('PROVIDER_TOKEN_KEY')),
    JSON.stringify(tokens),
    tokenContext(provider, accountRef),
  );
}

export const openAccount: AccountOpener = (row) => {
  const base = { provider: row.provider as ProviderName, accountRef: row.accountRef };
  if (!row.tokenCiphertext) return base;
  const tokens = JSON.parse(
    unseal(
      parseSealKey(env('PROVIDER_TOKEN_KEY')),
      row.tokenCiphertext,
      tokenContext(row.provider, row.accountRef),
    ),
  ) as { accessToken?: string };
  return { ...base, accessToken: tokens.accessToken };
};

export const paymentDeps = { portFor, openAccount };
