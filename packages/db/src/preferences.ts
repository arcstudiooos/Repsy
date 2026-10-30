import type { SystemTx, TenantTx } from './tenant';

/**
 * Whether `userId`, a member of the transaction's organization, wants new-message emails (S4-4). Preference rows
 * are self-only under RLS; the `app_message_email_opt_in` function (migration 000025) answers this one question for
 * an organization member and nothing else. False for anyone outside the organization.
 */
export async function wantsMessageEmail(tx: TenantTx, userId: string): Promise<boolean> {
  const rows = await (tx as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<{ optIn: boolean }[]>`
    SELECT app_message_email_opt_in(${userId}::uuid) AS "optIn"`;
  return rows[0]?.optIn === true;
}
