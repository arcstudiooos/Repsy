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

export interface EmailOptIns {
  digest: boolean;
  workout: boolean;
  checkin: boolean;
  habit: boolean;
}

/**
 * `userId`'s digest (PRD H14) and reminder (PRD H13) opt-ins, for a member of the transaction's organization; all false
 * for anyone else or without a preferences row. Through `app_email_opt_ins` (migration 000056), since preference rows
 * are self-only under RLS.
 */
export async function emailOptIns(tx: TenantTx, userId: string): Promise<EmailOptIns> {
  const rows = await (tx as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<EmailOptIns[]>`
    SELECT digest, workout, checkin, habit FROM app_email_opt_ins(${userId}::uuid)`;
  const r = rows[0];
  return {
    digest: r?.digest === true,
    workout: r?.workout === true,
    checkin: r?.checkin === true,
    habit: r?.habit === true,
  };
}
