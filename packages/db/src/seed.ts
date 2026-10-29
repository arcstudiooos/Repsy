import { appendAudit } from './audit';
import { createPilotCodeRow } from './pilotCodes';
import type { PrismaClient } from './generated/client';
import { withSystem } from './tenant';

export const MIN_SEED_PASSWORD_LENGTH = 12;

export const SEED_ADMIN_EMAIL = 'admin@example.test';
export const SEED_COACH_EMAIL = 'coach@example.test';
const ORG_NAME = 'Demo Coaching';
const SEED_CONSENT_VERSION = '2026-01';
const ORG_TIMEZONE = 'Europe/London';
/** Synthetic people only: each is a client user + membership + linked Client row. */
const SEED_CLIENTS = [
  { email: 'client1@example.test', name: 'Alex Rivers' },
  { email: 'client2@example.test', name: 'Sam Okafor' },
  { email: 'client3@example.test', name: 'Jordan Lee' },
];

export interface SeedDeps {
  hashPassword(password: string): Promise<string>;
  generatePilotCode(): { code: string; codeHash: string };
}

/** SEED_PASSWORD comes from the environment only; refuse to seed without a real one. */
export function requireSeedPassword(env: Record<string, string | undefined> = process.env): string {
  const password = env.SEED_PASSWORD;
  if (!password) throw new Error('SEED_PASSWORD is required (set it in your local environment)');
  if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`SEED_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters`);
  }
  return password;
}

/**
 * Idempotent demo data (system code): one platform admin, a demo coach with an
 * organization, three client users with `client` memberships, and one pilot code.
 * Returns the pilot code plaintext only on the run that created it; afterwards
 * only its hash exists, so reruns return `null`.
 */
export async function seedDemo(
  prisma: PrismaClient,
  password: string,
  deps: SeedDeps,
): Promise<{ pilotCode: string | null }> {
  const passwordHash = await deps.hashPassword(password);

  const adminId = await withSystem(async (tx) => {
    const upsertUser = async (email: string, name: string, isPlatformAdmin = false) => {
      const user = await tx.user.upsert({
        where: { email },
        create: { email, name, emailVerified: true, isPlatformAdmin },
        update: { emailVerified: true, isPlatformAdmin },
      });
      const credential = await tx.account.findFirst({
        where: { userId: user.id, providerId: 'credential' },
      });
      if (credential) {
        await tx.account.update({ where: { id: credential.id }, data: { password: passwordHash } });
      } else {
        await tx.account.create({
          data: {
            userId: user.id,
            providerId: 'credential',
            accountId: user.id,
            password: passwordHash,
          },
        });
      }
      return user;
    };

    const admin = await upsertUser(SEED_ADMIN_EMAIL, 'Demo Admin', true);
    const coach = await upsertUser(SEED_COACH_EMAIL, 'Demo Coach');

    let org = await tx.organization.findFirst({ where: { ownerUserId: coach.id } });
    if (!org) {
      org = await tx.organization.create({
        data: { name: ORG_NAME, timezone: ORG_TIMEZONE, ownerUserId: coach.id },
      });
      await appendAudit(tx, {
        orgId: org.id,
        actorId: coach.id,
        objectType: 'organization',
        objectId: org.id,
        action: 'org.created',
      });
    }
    const ensureMembership = (userId: string, role: 'owner' | 'client') =>
      tx.membership.upsert({
        where: { userId_organizationId_role: { userId, organizationId: org.id, role } },
        create: { userId, organizationId: org.id, role },
        update: { status: 'active' },
      });
    await ensureMembership(coach.id, 'owner');
    for (const client of SEED_CLIENTS) {
      const user = await upsertUser(client.email, client.name);
      await ensureMembership(user.id, 'client');
      await tx.client.upsert({
        where: { organizationId_email: { organizationId: org.id, email: client.email } },
        create: {
          organizationId: org.id,
          coachUserId: coach.id,
          userId: user.id,
          name: client.name,
          email: client.email,
          status: 'active',
          timezone: org.timezone,
          consentVersion: SEED_CONSENT_VERSION,
          consentAt: new Date(),
        },
        update: { userId: user.id, status: 'active' },
      });
    }
    return admin.id;
  }, prisma);

  const hasOpenCode =
    (await withSystem(
      (tx) =>
        tx.pilotCode.count({
          where: { createdBy: adminId, usedAt: null, expiresAt: { gt: new Date() } },
        }),
      prisma,
    )) > 0;
  if (hasOpenCode) return { pilotCode: null };

  const { code, codeHash } = deps.generatePilotCode();
  await createPilotCodeRow(prisma, { codeHash });
  return { pilotCode: code };
}
