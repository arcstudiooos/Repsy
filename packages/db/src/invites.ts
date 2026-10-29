import { withSystem } from './tenant';
import type { PrismaClient } from './generated/client';

export interface InviteLookup {
  inviteId: string;
  orgId: string;
  clientId: string;
  email: string;
  clientName: string;
  orgName: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Looks an invite up by the sha256 of its token. The invitee has no account or
 * membership yet, so this cannot run under a tenant scope: it is the ONLY
 * sanctioned request-path use of the RLS bypass for invites. It reads one row
 * by an unguessable hash and returns just what the accept page needs.
 */
export function findInviteByTokenHash(
  tokenHash: string,
  prisma?: PrismaClient,
): Promise<InviteLookup | null> {
  return withSystem(async (tx) => {
    const row = await tx.clientInvite.findUnique({
      where: { tokenHash },
      include: {
        client: { select: { name: true, email: true } },
        organization: { select: { name: true } },
      },
    });
    if (!row) return null;
    return {
      inviteId: row.id,
      orgId: row.organizationId,
      clientId: row.clientId,
      email: row.client.email,
      clientName: row.client.name,
      orgName: row.organization.name,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      revokedAt: row.revokedAt,
    };
  }, prisma);
}
