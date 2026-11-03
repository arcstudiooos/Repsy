import { withSystem, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import { emitClientEvent } from '../automations/events';
import { enqueueEmail } from '../outbox';
import { raiseFlag } from '../review/rules';

/**
 * PRD J4, J6 (D-013 #13): the daily package sweep. The workspace's renewal notice (1-30 days) before a recurring
 * purchase renews, or before a plan or fixed-term package ends, the client is emailed once for that date, a
 * `package_renewal_due` event starts any matching sequences, and the coach gets a follow-up review item. Packages
 * whose access has run out end here (`package_ended`); provider subscriptions end by their own webhook.
 */
const DAY = 86_400_000;

interface Due {
  at: Date;
  ending: boolean;
}

type Row = {
  id: string;
  clientId: string | null;
  packageId: string;
  provider: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  accessEndsAt: Date | null;
  installmentsPaid: number;
  renewalNotifiedFor: Date | null;
  package: { title: string; kind: string; installments: number | null };
};

/** When this purchase next renews or ends, if it does either on a known date. */
export function nextPackageDue(p: Row): Due | null {
  if (p.package.kind === 'one_off')
    return p.accessEndsAt ? { at: p.accessEndsAt, ending: true } : null;
  if (!p.currentPeriodEnd) return null;
  if (p.package.kind === 'plan') {
    const done = p.package.installments !== null && p.installmentsPaid >= p.package.installments;
    // A plan's earlier periods just take the next instalment; only its end is worth a notice.
    return done ? { at: p.currentPeriodEnd, ending: true } : null;
  }
  const ending = p.status === 'canceled' || p.cancelAtPeriodEnd;
  return { at: p.currentPeriodEnd, ending };
}

/** Whether a purchase's access has run out and nothing (no provider) will end it for us. */
function hasLapsed(p: Row, now: Date): boolean {
  if (p.package.kind === 'one_off') return p.accessEndsAt !== null && p.accessEndsAt <= now;
  const due = nextPackageDue(p);
  if (!due?.ending || due.at > now) return false;
  // Provider subscriptions end with `subscription_ended`; manual ones and finished plans end here.
  return p.provider === 'manual' || p.package.kind === 'plan';
}

async function sweepWorkspace(
  tx: TenantTx,
  now: Date,
): Promise<{ notified: number; ended: number }> {
  const org = await tx.organization.findFirstOrThrow({ select: { renewalNoticeDays: true } });
  const rows: Row[] = await tx.purchase.findMany({
    where: {
      status: { in: ['trialing', 'active', 'past_due', 'canceled'] },
      clientId: { not: null },
    },
    select: {
      id: true,
      clientId: true,
      packageId: true,
      provider: true,
      status: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      accessEndsAt: true,
      installmentsPaid: true,
      renewalNotifiedFor: true,
      package: { select: { title: true, kind: true, installments: true } },
    },
    take: 5000,
  });
  let notified = 0;
  let ended = 0;
  for (const p of rows) {
    const clientId = p.clientId!;
    if (hasLapsed(p, now)) {
      const { count } = await tx.purchase.updateMany({
        where: { id: p.id, status: p.status },
        data: { status: 'ended', endedAt: now, pastDueSince: null },
      });
      if (count === 1) {
        ended++;
        await emitClientEvent(tx, clientId, 'package_ended', {
          packageId: p.packageId,
          purchaseId: p.id,
        });
      }
      continue;
    }
    const due = nextPackageDue(p);
    if (!due || due.at <= now || due.at.getTime() - org.renewalNoticeDays * DAY > now.getTime()) {
      continue;
    }
    // Once per date, claimed under the row lock so two sweeps can't both notify.
    const { count } = await tx.purchase.updateMany({
      where: {
        id: p.id,
        OR: [{ renewalNotifiedFor: null }, { renewalNotifiedFor: { not: due.at } }],
      },
      data: { renewalNotifiedFor: due.at },
    });
    if (count === 0) continue;
    notified++;
    const at = due.at.toISOString();
    await emitClientEvent(tx, clientId, 'package_renewal_due', {
      packageId: p.packageId,
      purchaseId: p.id,
      dueAt: at,
      ending: due.ending,
    });
    await raiseFlag(tx, {
      clientId,
      ruleKey: 'package_renewal',
      sourceType: 'client',
      sourceId: p.id,
      dedupeKey: `package_renewal:${p.id}:${at}`,
      evidence: { purchaseId: p.id, packageTitle: p.package.title, dueAt: at, ending: due.ending },
      sourceDueAt: due.at,
    });
    const client = await tx.client.findFirst({
      where: { id: clientId, status: { in: ['active', 'invited', 'paused'] } },
      select: { email: true },
    });
    if (client) {
      await enqueueEmail(tx, {
        kind: 'billing',
        toEmail: client.email,
        templateKey: 'package_renewal',
        payload: { title: p.package.title, dueAt: at, ending: due.ending },
        idempotencyKey: `package_renewal:${p.id}:${at}`,
      });
    }
  }
  return { notified, ended };
}

/** Runs the sweep in each workspace with live purchases, each in its own tenant scope. */
export async function sweepPackages(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ notified: number; ended: number }> {
  const orgs = await withSystem(
    (tx) =>
      tx.purchase.findMany({
        where: { status: { in: ['trialing', 'active', 'past_due', 'canceled'] } },
        distinct: ['organizationId'],
        select: { organizationId: true },
      }),
    prisma,
  );
  const total = { notified: 0, ended: 0 };
  for (const { organizationId } of orgs) {
    const r = await withTenant(organizationId, (tx) => sweepWorkspace(tx, now), prisma);
    total.notified += r.notified;
    total.ended += r.ended;
  }
  return total;
}
