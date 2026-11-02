'use server';

import { headers } from 'next/headers';
import { DomainError, joinWithLink, startCheckout, submitLead } from '@kinetic/core';
import { prisma } from '@kinetic/db';
import { clientIp } from '@/server/clientIp';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { appOrigin, paymentDeps } from '@/server/payments';
import { RazorpayCouponUnsupported } from '@/server/payments/razorpay';

export interface JoinState {
  status?: 'sent' | 'closed' | 'full';
  fieldErrors?: Record<string, string>;
}

// Public form: a few sign-ups a minute per address, so a link can't be used to spam invite emails.
const limiter = new InMemoryRateLimiter({ capacity: 5, refillPerSecond: 5 / 60 });

/** PRD B3: someone signs up through a workspace link and gets the usual invite email. */
export async function joinAction(_prev: JoinState, data: FormData): Promise<JoinState> {
  const ip = clientIp(await headers());
  if (!limiter.consume(`ip:${ip}`).allowed) {
    return { fieldErrors: { form: 'Too many tries. Wait a minute and try again.' } };
  }
  try {
    const status = await joinWithLink(
      {
        token: String(data.get('token') ?? ''),
        name: String(data.get('name') ?? ''),
        email: String(data.get('email') ?? ''),
      },
      { prisma },
    );
    return { status };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      const fe = error.fieldErrors ?? {};
      return {
        fieldErrors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])),
      };
    }
    throw error;
  }
}

export interface LeadState {
  status?: 'sent';
  fieldErrors?: Record<string, string>;
}

// PRD B15: applications from the public page, a few a minute per address.
const leadLimiter = new InMemoryRateLimiter({ capacity: 5, refillPerSecond: 5 / 60 });

/** PRD B15: someone applies on a coach's public page. */
export async function applyAction(_prev: LeadState, data: FormData): Promise<LeadState> {
  const ip = clientIp(await headers());
  if (!leadLimiter.consume(`ip:${ip}`).allowed) {
    return { fieldErrors: { form: 'Too many tries. Wait a minute and try again.' } };
  }
  try {
    await submitLead(prisma, String(data.get('slug') ?? ''), {
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      phone: String(data.get('phone') ?? ''),
      message: String(data.get('message') ?? ''),
      website: String(data.get('website') ?? ''),
      loadedAt: Number(data.get('loadedAt') ?? 0),
    });
    return { status: 'sent' };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      const fe = error.fieldErrors ?? {};
      return {
        fieldErrors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])),
      };
    }
    if (error instanceof DomainError && error.code === 'NOT_FOUND') {
      return { fieldErrors: { form: 'This page is no longer taking applications.' } };
    }
    throw error;
  }
}

export interface CheckoutState {
  url?: string;
  fieldErrors?: Record<string, string>;
}

// PRD K4: a few checkouts a minute per address, so the storefront can't be used to spam a provider.
const checkoutLimiter = new InMemoryRateLimiter({ capacity: 6, refillPerSecond: 6 / 60 });

/** PRD K4: starts a hosted checkout for a storefront package; the browser then goes to the provider. */
export async function checkoutAction(_prev: CheckoutState, data: FormData): Promise<CheckoutState> {
  const ip = clientIp(await headers());
  if (!checkoutLimiter.consume(`ip:${ip}`).allowed) {
    return { fieldErrors: { form: 'Too many tries. Wait a minute and try again.' } };
  }
  const slug = String(data.get('slug') ?? '');
  const origin = appOrigin();
  try {
    const result = await startCheckout(
      prisma,
      slug,
      {
        packageId: String(data.get('packageId') ?? ''),
        name: String(data.get('name') ?? ''),
        email: String(data.get('email') ?? ''),
        region: String(data.get('region') ?? ''),
        coupon: String(data.get('coupon') ?? ''),
      },
      {
        ...paymentDeps,
        successUrl: `${origin}/join/${encodeURIComponent(slug)}/thanks?purchase={purchase}`,
        cancelUrl: `${origin}/join/${encodeURIComponent(slug)}`,
      },
    );
    return { url: result.url };
  } catch (error) {
    if (error instanceof RazorpayCouponUnsupported) {
      return { fieldErrors: { coupon: "Coupons can't be used on this package." } };
    }
    if (error instanceof DomainError) {
      if (error.code === 'VALIDATION') {
        const fe = error.fieldErrors ?? {};
        return {
          fieldErrors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])),
        };
      }
      if (error.code === 'CONFLICT' || error.code === 'NOT_FOUND') {
        return { fieldErrors: { form: error.message } };
      }
    }
    throw error;
  }
}
