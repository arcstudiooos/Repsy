import { z } from 'zod';
import {
  getCheckin,
  getCheckinTemplate,
  listCheckins,
  saveCheckinDraft,
  setCheckinWeekday,
  submitCheckin,
  updateCheckinTemplate,
  weekActivityBefore,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { onCheckinSubmitted } from '../reviewHooks';

/** `GET /api/v1/checkin-template`: the organization's template (seeded on first read). */
export const checkinTemplateGetRoute: RouteDef<undefined, true> = {
  can: 'checkin:manage',
  handler: ({ actor, tenant }) => tenant((tx) => getCheckinTemplate(tx, actor)),
};

// Questions are validated in core (fieldErrors `questions.*`).
const templateSchema = z.object({
  title: z.string().max(200).optional(),
  questions: z.array(z.unknown()).max(50).optional(),
});

/** `PATCH /api/v1/checkin-template`. Issued check-ins keep their questions. */
export const checkinTemplatePatchRoute: RouteDef<typeof templateSchema, true> = {
  can: 'checkin:manage',
  input: templateSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant((tx) => updateCheckinTemplate(tx, actor, input, { requestId })),
};

const weekdaySchema = z.object({ checkinWeekday: z.number().int().nullable() });

/** `PUT /api/v1/clients/:id/checkin-schedule`: the client's check-in weekday (null = none). */
export const clientCheckinSchedulePutRoute: RouteDef<typeof weekdaySchema, true> = {
  can: 'client:update',
  input: weekdaySchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) =>
      setCheckinWeekday(tx, actor, params.id ?? '', input.checkinWeekday, { requestId }),
    ),
};

const listSchema = z.object({ clientId: z.string().min(1).max(64).optional() });

/** `GET /api/v1/checkins`: the acting client's own, or (coach) one client's (`clientId`). Newest first. */
export const checkinsListRoute: RouteDef<typeof listSchema, true> = {
  can: 'checkin:read',
  input: listSchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => listCheckins(tx, actor, input)),
};

/** `GET /api/v1/checkins/:id`. Coaches also get the week before it (`meta.activity`). */
export const checkinGetRoute: RouteDef<undefined, true> = {
  can: 'checkin:read',
  handler: async ({ actor, params, tenant }) => {
    const { checkin, activity } = await tenant(async (tx) => {
      const c = await getCheckin(tx, actor, params.id ?? '');
      const a =
        actor.role === 'client'
          ? null
          : await weekActivityBefore(tx, actor, c.clientId, c.periodLocalDate);
      return { checkin: c, activity: a };
    });
    return activity ? new ApiResult(checkin, { meta: { activity } }) : checkin;
  },
};

const draftSchema = z.object({ answers: z.record(z.string(), z.unknown()) });

/** `PUT /api/v1/checkins/:id/draft`: the client's autosaved answers. */
export const checkinDraftPutRoute: RouteDef<typeof draftSchema, true> = {
  can: 'checkin:submit',
  input: draftSchema,
  rateLimit: { capacity: 60, refillPerSecond: 1 },
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => saveCheckinDraft(tx, actor, params.id ?? '', input.answers)),
};

const submitSchema = z.object({
  answers: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

/** `POST /api/v1/checkins/:id/submit`: idempotent on `idempotencyKey`. */
export const checkinSubmitRoute: RouteDef<typeof submitSchema, true> = {
  can: 'checkin:submit',
  input: submitSchema,
  handler: async ({ actor, input, params, requestId, tenant, track, clientHash }) => {
    const t0 = Date.now();
    const checkin = await tenant((tx) =>
      submitCheckin(tx, actor, params.id ?? '', input, {
        requestId,
        onSubmitted: onCheckinSubmitted,
      }),
    );
    // A replayed submission returns the stored one: only a new submission is an event.
    if (checkin.submittedAt && Date.parse(checkin.submittedAt) >= t0) {
      track('checkin_submitted', {
        client_id_hash: clientHash(checkin.clientId),
        answered_count: Object.keys(checkin.answers ?? {}).length,
      });
      track('review_flag_opened', { rule_key: 'checkin_new' });
    }
    return checkin;
  },
};
