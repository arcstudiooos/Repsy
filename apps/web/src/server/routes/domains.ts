import { z } from 'zod';
import {
  addCustomDomain,
  getCustomDomain,
  recheckCustomDomain,
  removeCustomDomain,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { appOrigin } from '../payments';

/** PRD L4 (D-013 #15): the workspace's custom domain (managers). */
const appHost = () => new URL(appOrigin()).hostname;

export const domainGetRoute: RouteDef<undefined, true> = {
  can: 'settings:org:update',
  handler: async ({ actor, tenant }) => ({
    domain: await tenant((tx) => getCustomDomain(tx, actor)),
    cnameTarget: appHost(),
  }),
};

const addSchema = z.object({ hostname: z.string().max(260) });

export const domainPostRoute: RouteDef<typeof addSchema, true> = {
  can: 'settings:org:update',
  input: addSchema,
  rateLimit: { capacity: 5, refillPerSecond: 5 / 60 },
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) => addCustomDomain(tx, actor, input, { appHost: appHost(), requestId })),
      { status: 201 },
    ),
};

export const domainDeleteRoute: RouteDef<undefined, true> = {
  can: 'settings:org:update',
  handler: async ({ actor, requestId, tenant }) => {
    await tenant((tx) => removeCustomDomain(tx, actor, { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

export const domainCheckRoute: RouteDef<undefined, true> = {
  can: 'settings:org:update',
  rateLimit: { capacity: 5, refillPerSecond: 5 / 60 },
  handler: async ({ actor, tenant }) => {
    await tenant((tx) => recheckCustomDomain(tx, actor));
    return new ApiResult(null, { status: 204 });
  },
};
