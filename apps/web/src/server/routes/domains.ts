import { z } from 'zod';
// NOTE (slice merge): see apps/web/src/server/routes/scheduling.ts — the
// parent adds these names to packages/core/src/index.ts first.
import {
  listCustomDomains,
  markDomainVerified,
  requestCustomDomain,
  setBrandedSender,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

const domainSchema = z.object({ hostname: z.string().max(253) });

/** `GET /api/v1/domains` (PRD L4). Managers only (settings:org:update). */
export const domainsListRoute: RouteDef<undefined, true> = {
  feature: 'customDomains',
  can: 'settings:org:update',
  handler: ({ actor, tenant }) => tenant((tx) => listCustomDomains(tx, actor)),
};

/** `POST /api/v1/domains` (PRD L4): request a domain, get its TXT token. */
export const domainsPostRoute: RouteDef<typeof domainSchema, true> = {
  feature: 'customDomains',
  can: 'settings:org:update',
  input: domainSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => requestCustomDomain(tx, actor, input)), { status: 201 }),
};

/**
 * `POST /api/v1/domains/:id/verify` (PRD L4): records the coach's attestation
 * that DNS is set. It does NOT check DNS — see packages/core/src/domains/domains.ts.
 */
export const domainVerifyRoute: RouteDef<undefined, true> = {
  feature: 'customDomains',
  can: 'settings:org:update',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => markDomainVerified(tx, actor, params.id ?? '')),
};

const senderSchema = z.object({
  domainId: z.string().max(64),
  brandedFromLocal: z.string().max(64),
});

/** `POST /api/v1/domains/sender` (PRD L4): branded sending address on a verified domain. */
export const domainSenderRoute: RouteDef<typeof senderSchema, true> = {
  feature: 'customDomains',
  can: 'settings:org:update',
  input: senderSchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => setBrandedSender(tx, actor, input)),
};
