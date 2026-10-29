import type { Prisma } from './generated/client';
import type { TenantTx } from './tenant';

export interface AuditInput {
  orgId: string;
  actorId: string | null;
  objectType: string;
  objectId: string;
  action: string;
  /** Scalars only: audit events never carry message content. */
  metadata?: Record<string, string | number | boolean>;
  requestId?: string;
}

export function appendAudit(tx: TenantTx, input: AuditInput) {
  const data: Prisma.AuditEventUncheckedCreateInput = {
    organizationId: input.orgId,
    actorId: input.actorId,
    objectType: input.objectType,
    objectId: input.objectId,
    action: input.action,
    metadataJson: input.metadata ?? {},
    requestId: input.requestId ?? null,
  };
  return tx.auditEvent.create({ data });
}
