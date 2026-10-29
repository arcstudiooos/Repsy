'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { DomainError } from '@kinetic/core';
import { prisma } from '@kinetic/db';
import { getSessionUser } from '@/lib/auth';
import { CODE_INVALID, redeemPilotCode, validTimezone } from '@/lib/register-coach';

export interface RedeemState {
  fieldErrors?: Record<string, string>;
}

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function redeemPilotCodeAction(
  _prev: RedeemState,
  data: FormData,
): Promise<RedeemState> {
  const requestHeaders = await headers();
  const user = await getSessionUser(requestHeaders);
  if (!user?.emailVerified) redirect('/login?next=%2Fonboarding%2Fpilot-code');

  const pilotCode = field(data, 'pilotCode');
  const orgName = field(data, 'orgName');
  const timezone = field(data, 'timezone');
  const fieldErrors: Record<string, string> = {};
  if (!orgName) fieldErrors.orgName = 'Enter your business name.';
  if (!validTimezone(timezone)) fieldErrors.timezone = 'Choose a valid time zone.';
  if (!pilotCode) fieldErrors.pilotCode = 'Enter your pilot code.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  try {
    await redeemPilotCode(
      { prisma, headers: requestHeaders, user },
      { pilotCode, orgName, timezone },
    );
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === 'ALREADY_ONBOARDED') redirect('/app');
      if (error.code === 'RATE_LIMITED') return { fieldErrors: { form: error.message } };
      return { fieldErrors: { pilotCode: CODE_INVALID } };
    }
    throw error;
  }
  redirect('/app');
}
