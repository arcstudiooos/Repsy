'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { acceptTeamInvite, DomainError } from '@repsy/core';
import { prisma } from '@repsy/db';
import { getSessionUser } from '@/lib/auth';

/** PRD A10: the signed-in, verified invitee joins the team, then picks the workspace to open. */
export async function joinTeamAction(token: string): Promise<{ error: string } | never> {
  const user = await getSessionUser(await headers());
  if (!user) redirect(`/login?next=${encodeURIComponent(`/team/join/${token}`)}`);
  try {
    await acceptTeamInvite(prisma, token, user);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  redirect('/select-org');
}
