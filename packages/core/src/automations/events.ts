import type { Prisma, SystemTx, TenantTx } from '@kinetic/db';

/**
 * PRD J2: what automations react to. Written in the same transaction as the change that caused it, so an event exists
 * exactly when its cause committed; the worker turns events into sequence runs.
 */
export const CLIENT_EVENTS = [
  'invite_accepted',
  'intake_submitted',
  'checkin_submitted',
  'program_finished',
  'tag_added',
  'stage_changed',
] as const;
export type ClientEventKind = (typeof CLIENT_EVENTS)[number];

export async function emitClientEvent(
  tx: TenantTx,
  clientId: string,
  kind: ClientEventKind,
  detail: Prisma.InputJsonObject = {},
): Promise<void> {
  await tx.clientEvent.create({
    data: { clientId, kind, detailJson: detail },
  } as Parameters<typeof tx.clientEvent.create>[0]);
}

/** The same, from system scope (pre-membership flows such as accepting an invite). */
export async function emitClientEventAsSystem(
  tx: SystemTx,
  orgId: string,
  clientId: string,
  kind: ClientEventKind,
  detail: Prisma.InputJsonObject = {},
): Promise<void> {
  await tx.clientEvent.create({
    data: { organizationId: orgId, clientId, kind, detailJson: detail },
  });
}
