import { withSystem, type PrismaClient } from '@kinetic/db';
import type { Auth } from '@/lib/auth';
import { ORG_COOKIE, signOrgCookie } from '@/server/orgCookie';

export const TEST_SECRET = 'test-secret-test-secret-test-secret-1';
export const TEST_PASSWORD = 'correct-horse-battery';

export interface SeededUser {
  id: string;
  email: string;
  /** Session cookie header value (no org cookie). */
  cookie: string;
}

export interface TwoTenants {
  orgA: { id: string };
  orgB: { id: string };
  /** owner of A */
  coachA: SeededUser;
  /** owner of B */
  coachB: SeededUser;
  /** client member of A */
  clientA: SeededUser;
  /** owner of A and client of B */
  dualRoleUser: SeededUser;
}

async function createUser(prisma: PrismaClient, auth: Auth, label: string): Promise<SeededUser> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  await auth.api.signUpEmail({ body: { name: label, email, password: TEST_PASSWORD } });
  await withSystem(
    (tx) => tx.user.update({ where: { email }, data: { emailVerified: true } }),
    prisma,
  );
  const res = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    returnHeaders: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const user = await withSystem((tx) => tx.user.findUniqueOrThrow({ where: { email } }), prisma);
  return { id: user.id, email, cookie };
}

/** Users and memberships only: there is no Client model before Sprint 1. */
export async function seedTwoTenants(prisma: PrismaClient, auth: Auth): Promise<TwoTenants> {
  const coachA = await createUser(prisma, auth, 'coach-a');
  const coachB = await createUser(prisma, auth, 'coach-b');
  const clientA = await createUser(prisma, auth, 'client-a');
  const dualRoleUser = await createUser(prisma, auth, 'dual');
  const { orgA, orgB } = await withSystem(async (tx) => {
    const a = await tx.organization.create({
      data: { name: 'Org A', timezone: 'UTC', ownerUserId: coachA.id },
    });
    const b = await tx.organization.create({
      data: { name: 'Org B', timezone: 'UTC', ownerUserId: coachB.id },
    });
    await tx.membership.createMany({
      data: [
        { userId: coachA.id, organizationId: a.id, role: 'owner' },
        { userId: coachB.id, organizationId: b.id, role: 'owner' },
        { userId: clientA.id, organizationId: a.id, role: 'client' },
        { userId: dualRoleUser.id, organizationId: a.id, role: 'owner' },
        { userId: dualRoleUser.id, organizationId: b.id, role: 'client' },
      ],
    });
    return { orgA: a, orgB: b };
  }, prisma);
  return { orgA: { id: orgA.id }, orgB: { id: orgB.id }, coachA, coachB, clientA, dualRoleUser };
}

/** Request headers for `user`, acting in `orgId` via a correctly signed `kinetic_org` cookie. */
export function headersFor(user: SeededUser, orgId?: string): Headers {
  const cookie =
    orgId === undefined
      ? user.cookie
      : `${user.cookie}; ${ORG_COOKIE}=${signOrgCookie(user.id, orgId, TEST_SECRET)}`;
  return new Headers({ cookie });
}
