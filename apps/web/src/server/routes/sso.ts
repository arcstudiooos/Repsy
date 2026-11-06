import { z } from 'zod';
import { clearSsoSetting, getSsoSetting, saveSsoSetting } from '@kinetic/core';
import { auth } from '@/lib/auth';
import type { RouteDef } from '../api';

/** PRD A16: the workspace's single sign-on setting. Read by staff; changed by owners and admins. */
export const ssoGetRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: ({ actor, tenant }) => tenant((tx) => getSsoSetting(tx, actor)),
};

const ssoSchema = z.object({
  provider: z.enum(['google', 'microsoft']),
  domain: z.string().max(253),
  microsoftTenantId: z.string().max(64).nullable().optional(),
  enforced: z.boolean(),
});

export const ssoPutRoute: RouteDef<typeof ssoSchema, true> = {
  can: 'settings:org:update',
  input: ssoSchema,
  rateLimit: { capacity: 20, refillPerSecond: 20 / 3600 },
  handler: async ({ actor, input, tenant, request }) => {
    // Which providers the manager has signed in with: enforcing SSO requires one, to avoid a lock-out.
    const accounts = await auth.api.listUserAccounts({ headers: request.headers });
    const linked = accounts.map((a) => a.providerId);
    return tenant((tx) => saveSsoSetting(tx, actor, input, linked));
  },
};

export const ssoDeleteRoute: RouteDef<undefined, true> = {
  can: 'settings:org:update',
  handler: ({ actor, tenant }) => tenant((tx) => clearSsoSetting(tx, actor)),
};
