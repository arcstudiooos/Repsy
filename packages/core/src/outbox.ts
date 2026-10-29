import type { Prisma, SystemTx, TenantTx } from '@kinetic/db';

export interface EnqueueEmailInput {
  kind: string;
  toUserId: string;
  templateKey: string;
  payload: Prisma.InputJsonObject;
  /** Same key enqueued twice produces one row. */
  idempotencyKey: string;
}

/**
 * Enqueues an email in the caller's transaction so it commits or rolls back
 * with the triggering write. The tenant tx supplies the organization.
 * Returns false when the idempotency key was already enqueued.
 */
export async function enqueueEmail(tx: TenantTx, input: EnqueueEmailInput): Promise<boolean> {
  // organizationId is injected by the tenant-scoped client.
  const data = {
    kind: input.kind,
    toUserId: input.toUserId,
    templateKey: input.templateKey,
    payloadJson: input.payload,
    idempotencyKey: input.idempotencyKey,
  } as Prisma.OutboxEmailUncheckedCreateInput;
  const { count } = await tx.outboxEmail.createMany({ data: [data], skipDuplicates: true });
  return count === 1;
}

/**
 * Enqueues an email that belongs to no organization (account verification,
 * password reset). System scope only: null-org rows are visible solely under
 * the RLS bypass. Returns false when the idempotency key was already enqueued.
 */
export async function enqueuePlatformEmail(
  tx: SystemTx,
  input: EnqueueEmailInput,
): Promise<boolean> {
  const { count } = await tx.outboxEmail.createMany({
    data: [
      {
        organizationId: null,
        kind: input.kind,
        toUserId: input.toUserId,
        templateKey: input.templateKey,
        payloadJson: input.payload,
        idempotencyKey: input.idempotencyKey,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}
