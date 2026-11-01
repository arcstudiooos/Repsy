import { z } from 'zod';
import {
  acceptAgreement,
  archiveAgreement,
  createAgreement,
  listAgreements,
  updateAgreement,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { clientIp } from '../clientIp';

const agreementSchema = z.object({ title: z.string().max(200), body: z.string().max(25_000) });

/** `GET /api/v1/agreements` (PRD B14): the workspace's live agreements. */
export const agreementsListRoute: RouteDef<undefined, true> = {
  can: 'client:read',
  handler: ({ tenant }) => tenant((tx) => listAgreements(tx)),
};

/** `POST /api/v1/agreements`: publish one (owner). */
export const agreementsPostRoute: RouteDef<typeof agreementSchema, true> = {
  can: 'client:update',
  input: agreementSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => createAgreement(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

/** `PATCH /api/v1/agreements/:id`: a changed text is a new version every client accepts again. */
export const agreementPatchRoute: RouteDef<typeof agreementSchema, true> = {
  can: 'client:update',
  input: agreementSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => updateAgreement(tx, actor, params.id, input, { requestId })),
};

/** `DELETE /api/v1/agreements/:id`: stop asking for it (acceptances are kept). */
export const agreementDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveAgreement(tx, actor, params.id, { requestId }));
    return { archived: true };
  },
};

const acceptSchema = z.object({ version: z.number().int().min(1) });

/** `POST /api/v1/agreements/:id/accept`: the client accepts the version they read; the time and IP are kept. */
export const agreementAcceptRoute: RouteDef<typeof acceptSchema, true> = {
  input: acceptSchema,
  rateLimit: { capacity: 30, refillPerSecond: 30 / 3600 },
  handler: async ({ actor, input, params, request, requestId, tenant }) => {
    const seen = clientIp(request.headers);
    const ip = seen === 'unknown' ? null : seen;
    await tenant((tx) =>
      acceptAgreement(tx, actor, params.id, { version: input.version, ip }, { requestId }),
    );
    return { accepted: true };
  },
};
