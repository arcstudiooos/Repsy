import { appendAudit, type SystemTx } from '@kinetic/db';
import { DomainError } from '../errors';
import { canonicalTimezone } from '../timezone';
import { hashPilotCode } from './pilotCode';

/** PRD A4: a workspace without a pilot code is a trial: this many days, this many active clients. */
export const TRIAL_DAYS = 7;
export const TRIAL_CLIENT_LIMIT = 3;

export interface SignupCoachInput {
  userId: string;
  /** Blank: a self-serve trial (PRD A4). */
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
  const timezone = canonicalTimezone(input.timezone);
  if (!timezone) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      timezone: ['Choose a valid time zone.'],
    });
  }
  const now = new Date();
  const trial = input.pilotCode.trim() === '';
  if (!trial) {
    // Atomic claim: only one concurrent caller can flip an unused, unexpired code.
    const claimed = await tx.pilotCode.updateMany({
      where: {
        codeHash: hashPilotCode(input.pilotCode),
        usedAt: null,
        usedBy: null,
        expiresAt: { gt: now },
      },
      data: { usedBy: input.userId, usedAt: now },
    });
    if (claimed.count !== 1) {
      throw new DomainError('PILOT_CODE_INVALID', 'This pilot code is invalid or has expired.');
    }
  }

  const org = await tx.organization.create({
    data: {
      name: input.orgName,
      timezone,
      ownerUserId: input.userId,
      ...(trial
        ? {
            plan: 'trial',
            activeClientLimit: TRIAL_CLIENT_LIMIT,
            trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
          }
        : {}),
    },
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
    metadata: { plan: trial ? 'trial' : 'pilot' },
  });
  return { orgId: org.id };
}
