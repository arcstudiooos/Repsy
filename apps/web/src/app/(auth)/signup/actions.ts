'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@kinetic/db';
import { auth } from '@/lib/auth';
import { registerCoach } from '@/lib/register-coach';

export interface SignupState {
  fieldErrors?: Record<string, string>;
}

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

/** Coach signup. The user id never comes from the client; see registerCoach. */
export async function signUpCoachAction(_prev: SignupState, data: FormData): Promise<SignupState> {
  const result = await registerCoach(
    { auth, prisma, headers: await headers() },
    {
      name: field(data, 'name'),
      email: field(data, 'email'),
      password: String(data.get('password') ?? ''),
      orgName: field(data, 'orgName'),
      timezone: field(data, 'timezone'),
      pilotCode: field(data, 'pilotCode'),
    },
  );
  if (!result.ok) return { fieldErrors: result.fieldErrors };
  redirect('/verify-email');
}
