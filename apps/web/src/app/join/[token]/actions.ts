'use server';

import { headers } from 'next/headers';
import { DomainError, joinWithLink } from '@kinetic/core';
import { prisma } from '@kinetic/db';
import { clientIp } from '@/server/clientIp';
import { InMemoryRateLimiter } from '@/server/rateLimit';

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
