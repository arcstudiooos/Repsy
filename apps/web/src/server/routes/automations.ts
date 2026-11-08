import { z } from 'zod';
import {
  archiveSequence,
  cancelRun,
  decideStepRun,
  listSequences,
  saveSequence,
  startSequence,
} from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

const stepSchema = z.object({
  dayOffset: z.number().int(),
  localTime: z.string().max(5),
  type: z.string().max(20),
  config: z.record(z.string(), z.union([z.string().max(4000), z.number()])),
  askFirst: z.boolean().optional(),
});
const sequenceSchema = z.object({
  name: z.string().max(200),
  trigger: z.string().max(40),
  triggerValue: z.string().max(64).nullable().optional(),
  active: z.boolean().optional(),
  steps: z.array(stepSchema).max(40),
});

/** `GET /api/v1/automations` (PRD J1). */
export const automationsListRoute: RouteDef<undefined, true> = {
  can: 'client:read',
  handler: ({ actor, tenant }) => tenant((tx) => listSequences(tx, actor)),
};

/** `POST /api/v1/automations`: a new automation. */
export const automationsPostRoute: RouteDef<typeof sequenceSchema, true> = {
  can: 'client:update',
  input: sequenceSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveSequence(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

/** `PUT /api/v1/automations/:id`: replace its trigger and steps. */
export const automationPutRoute: RouteDef<typeof sequenceSchema, true> = {
  can: 'client:update',
  input: sequenceSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveSequence(tx, actor, { ...input, id: params.id }, { requestId })),
};

/** `DELETE /api/v1/automations/:id`: archive it (running clients stop). */
export const automationDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => archiveSequence(tx, actor, params.id));
    return { archived: true };
  },
};

const startSchema = z.object({ clientId: z.string().max(64) });

/** `POST /api/v1/automations/:id/start`: start it for one client by hand. */
export const automationStartRoute: RouteDef<typeof startSchema, true> = {
  can: 'client:update',
  input: startSchema,
  handler: async ({ actor, input, params, tenant }) => {
    await tenant((tx) => startSequence(tx, actor, params.id, input.clientId));
    return { started: true };
  },
};

const decideSchema = z.object({ decision: z.enum(['approve', 'skip']) });

/** `POST /api/v1/automation-steps/:id/decide` (PRD J7): approve or skip a waiting step. */
export const automationDecideRoute: RouteDef<typeof decideSchema, true> = {
  can: 'review:update',
  input: decideSchema,
  handler: async ({ actor, input, params, tenant }) => ({
    result: await tenant((tx) => decideStepRun(tx, actor, params.id, input.decision)),
  }),
};

/** `DELETE /api/v1/automation-runs/:id`: stop a client's run. */
export const automationRunDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => cancelRun(tx, actor, params.id));
    return { cancelled: true };
  },
};
