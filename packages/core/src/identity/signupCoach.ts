import { appendAudit, type SystemTx } from '@kinetic/db';
import { DomainError } from '../errors';
import { hashPilotCode } from './pilotCode';

export interface SignupCoachInput {
  userId: string;
  pilotCode: string;
  orgName: string;
  timezone: string;
}

/**
 * Provisions a coach workspace. Runs in system scope (the org does not exist
 * yet) and must be called inside one transaction: redeems the pilot code,
 * creates the organization and owner membership, and audits `org.created`.
 */
export async function signupCoach(
  tx: SystemTx,
  input: SignupCoachInput,
): Promise<{ orgId: string }> {
  // Atomic claim: only one concurrent caller can flip an unused, unexpired code.
  const claimed = await tx.pilotCode.updateMany({
    where: {
      codeHash: hashPilotCode(input.pilotCode),
      usedAt: null,
      usedBy: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedBy: input.userId, usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new DomainError('PILOT_CODE_INVALID', 'This pilot code is invalid or has expired.');
  }

  const org = await tx.organization.create({
    data: { name: input.orgName, timezone: input.timezone, ownerUserId: input.userId },
  });
  await tx.membership.create({
    data: { userId: input.userId, organizationId: org.id, role: 'owner' },
  });
  await appendAudit(tx, {
    orgId: org.id,
    actorId: input.userId,
    objectType: 'organization',
    objectId: org.id,
    action: 'org.created',
  });
  return { orgId: org.id };
}
