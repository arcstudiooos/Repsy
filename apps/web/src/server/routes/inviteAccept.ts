import { z } from 'zod';
import { GOALS_MAX } from '@kinetic/core';
import { acceptSignedIn } from '@/lib/accept-invite';
import { ApiResult, type RouteDef } from '../api';

const schema = z.object({
  token: z.string().min(20).max(200),
  // Consent is explicit: anything but `true` is a validation error.
  consent: z.literal(true),
  timezone: z.string().min(1).max(100),
  preferredUnits: z.enum(['kg', 'lb']),
  goals: z.string().max(GOALS_MAX).optional(),
});

/**
 * Signed-in invite acceptance. No active org yet (the invitee may have none),
 * so `requireOrg: false`; the org comes from the invite and is set as the
 * active org on success.
 */
export const inviteAcceptRoute: RouteDef<typeof schema, false> = {
  requireOrg: false,
  input: schema,
  handler: async ({ user, input, prisma, orgCookie }) => {
    const { orgId, clientId } = await acceptSignedIn({ prisma }, user, input);
    return new ApiResult({ orgId, clientId }, { headers: { 'set-cookie': orgCookie(orgId) } });
  },
};
