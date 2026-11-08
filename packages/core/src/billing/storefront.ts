import { withTenant, type PrismaClient, type SystemTx } from '@repsy/db';
import { SLUG } from '../leads/leads';
import { listStorefrontPackages, type PackageView } from './packages';

/**
 * Public storefront for `/join/<slug>` (K4, B15). Kept in its own module so
 * the pure billing modules never import the database runtime: `packages.ts`
 * only ever takes a `tx`, while this file resolves a slug to a tenant scope.
 *
 * Resolves the workspace the same way the public profile does (an enabled
 * page only, id only) and reads active packages in its tenant scope. Buying
 * is not open to anonymous visitors: a coach creates the checkout (see
 * createCheckout) and sends the hosted link, so no unauthenticated purchase
 * endpoint exists. The join page keeps its existing bio, offers and
 * application form untouched.
 */
export async function getPublicStorefront(
  prisma: PrismaClient,
  slug: string,
): Promise<{ orgName: string; packages: PackageView[] } | null> {
  if (!SLUG.test(slug)) return null;
  const rows = await (prisma as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<
    { id: string | null }[]
  >`SELECT app_org_by_public_slug(${slug}) AS id`;
  const orgId = rows[0]?.id ?? null;
  if (!orgId) return null;
  return withTenant(
    orgId,
    async (tx) => {
      const org = await tx.organization.findFirstOrThrow({ select: { name: true } });
      return { orgName: org.name, packages: await listStorefrontPackages(tx) };
    },
    prisma,
  );
}
