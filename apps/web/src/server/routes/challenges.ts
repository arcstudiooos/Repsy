import { z } from 'zod';
import { archiveChallenge, joinChallenge, leaveChallenge, saveChallenge } from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

const schema = z.object({
  title: z.string().max(500),
  description: z.string().max(5000).optional(),
  metric: z.string().max(20),
  startLocalDate: z.string().max(10),
  endLocalDate: z.string().max(10),
  groupId: z.string().max(64).nullable().optional(),
});

/** `POST /api/v1/challenges` (PRD H9). */
export const challengesPostRoute: RouteDef<typeof schema, true> = {
  can: 'client:update',
  input: schema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveChallenge(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const challengePutRoute: RouteDef<typeof schema, true> = {
  can: 'client:update',
  input: schema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveChallenge(tx, actor, { ...input, id: params.id }, { requestId })),
};

export const challengeDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveChallenge(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const joinSchema = z.object({ joined: z.boolean(), onLeaderboard: z.boolean().optional() });

/** `PUT /api/v1/challenges/:id/participation`: the client joins, changes their leaderboard choice, or leaves. */
export const challengeParticipationRoute: RouteDef<typeof joinSchema, true> = {
  can: 'session:log',
  input: joinSchema,
  handler: async ({ actor, input, params, tenant }) => {
    await tenant((tx) =>
      input.joined
        ? joinChallenge(tx, actor, params.id ?? '', { onLeaderboard: input.onLeaderboard })
        : leaveChallenge(tx, actor, params.id ?? ''),
    );
    return { joined: input.joined };
  },
};
