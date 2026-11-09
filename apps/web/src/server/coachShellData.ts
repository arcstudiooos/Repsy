import { cache } from 'react';
import { countOpenFlags, DomainError, twoFactorStatus, unreadMessageCount } from '@repsy/core';
import { withServerTenant } from './serverActor';

/** A role that may not read one item leaves it out; a database error still fails the transaction. */
async function allowed<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/**
 * Everything the coach rail and banners read, in one transaction and once per request. Each used to open its own
 * transaction on every page. Any failure leaves the shell without these details rather than breaking the page.
 */
export const getCoachShellData = cache(async () =>
  withServerTenant(async (tx, actor) => ({
    review: (await allowed(() => countOpenFlags(tx, actor)))?.total ?? null,
    messages: await allowed(() => unreadMessageCount(tx, actor)),
    org: await tx.organization.findFirst({
      where: { id: actor.orgId },
      select: { name: true, trialEndsAt: true, activeClientLimit: true },
    }),
    twoFactor: await allowed(() => twoFactorStatus(tx, actor)),
  })).catch(() => null),
);
