import { z } from 'zod';
import {
  addAssessmentPhoto,
  archiveAssessment,
  assignAssessment,
  deleteAssessmentPhoto,
  endClientAssessment,
  saveAssessment,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

const schema = z.object({
  title: z.string().max(500),
  instructions: z.string().max(5000).optional(),
  guide: z.string().max(20).optional(),
  everyWeeks: z.number().int().optional(),
});

/** `POST /api/v1/assessments` (PRD E5). */
export const assessmentsPostRoute: RouteDef<typeof schema, true> = {
  can: 'client:update',
  input: schema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveAssessment(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

/** `PUT /api/v1/assessments/:id`. */
export const assessmentPutRoute: RouteDef<typeof schema, true> = {
  can: 'client:update',
  input: schema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveAssessment(tx, actor, { ...input, id: params.id }, { requestId })),
};

/** `DELETE /api/v1/assessments/:id`: archive it; clients stop being asked. */
export const assessmentDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveAssessment(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const assignSchema = z.object({ assessmentId: z.string().max(64) });

/** `POST /api/v1/clients/:id/assessments`: ask the client for it. */
export const clientAssessmentPostRoute: RouteDef<typeof assignSchema, true> = {
  can: 'client:update',
  input: assignSchema,
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) =>
        assignAssessment(tx, actor, { ...input, clientId: params.id }, { requestId }),
      ),
      { status: 201 },
    ),
};

/** `DELETE /api/v1/client-assessments/:id`: stop asking. */
export const clientAssessmentDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => endClientAssessment(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const photoSchema = z.object({
  mediaId: z.string().max(64),
  takenOn: z.string().max(20).optional(),
});

/** `POST /api/v1/client-assessments/:id/photos`: record an uploaded photo. */
export const assessmentPhotoPostRoute: RouteDef<typeof photoSchema, true> = {
  can: 'metric:write',
  input: photoSchema,
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) =>
        addAssessmentPhoto(tx, actor, { ...input, clientAssessmentId: params.id }, { requestId }),
      ),
      { status: 201 },
    ),
};

/** `DELETE /api/v1/assessment-photos/:id`. */
export const assessmentPhotoDeleteRoute: RouteDef<undefined, true> = {
  can: 'metric:write',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => deleteAssessmentPhoto(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};
