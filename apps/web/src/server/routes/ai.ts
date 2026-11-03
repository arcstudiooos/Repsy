import { z } from 'zod';
import {
  AiUnavailableError,
  completeHighlights,
  completeProgramDraft,
  DomainError,
  draftProgramFromText,
  clientNamesForRedaction,
  exerciseLibraryNames,
  finishAiRequest,
  getAiSettings,
  highlightsRequest,
  setAiEnabled,
  startAiRequest,
  templateDraftRequest,
  type ActorContext,
  type AiKind,
} from '@kinetic/core';
import type { TenantTx } from '@kinetic/db';
import { ApiResult, type RouteDef } from '../api';
import { aiPortFromEnv } from '../ai/anthropic';

/**
 * PRD I10-I12, I14 (D-013 #14): AI drafting routes. Each one reserves a slot under the daily cap in one short
 * transaction, calls the provider with no transaction open, then records the outcome (sizes only) in another.
 */

type Tenant = <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;

const port = () => {
  const p = aiPortFromEnv();
  if (!p) throw new DomainError('NOT_FOUND', 'AI drafting is not available on this site.');
  return p;
};

async function run<T extends { removedLines?: number; removed?: number }>(
  tenant: Tenant,
  actor: ActorContext,
  kind: AiKind,
  inputChars: number,
  call: () => Promise<T>,
  outputChars: (r: T) => number,
): Promise<T> {
  const { requestId } = await tenant((tx) => startAiRequest(tx, actor, kind, inputChars));
  try {
    const result = await call();
    await tenant((tx) =>
      finishAiRequest(tx, actor, requestId, {
        kind,
        status: 'ok',
        outputChars: outputChars(result),
        removedLines: result.removedLines ?? result.removed ?? 0,
      }),
    );
    return result;
  } catch (e) {
    const status = e instanceof AiUnavailableError ? e.reason : 'error';
    await tenant((tx) => finishAiRequest(tx, actor, requestId, { kind, status }));
    if (e instanceof AiUnavailableError) throw new DomainError('AI_UNAVAILABLE', e.message);
    throw e;
  }
}

export const aiSettingsGetRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: ({ actor, tenant }) =>
    tenant((tx) => getAiSettings(tx, actor, { available: aiPortFromEnv() !== null })),
};

const settingsSchema = z.object({ enabled: z.boolean() });

export const aiSettingsPutRoute: RouteDef<typeof settingsSchema, true> = {
  input: settingsSchema,
  handler: async ({ actor, input, requestId, tenant }) => {
    await tenant((tx) => setAiEnabled(tx, actor, input.enabled, { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const fromTextSchema = z.object({
  text: z.string().max(20_000),
  units: z.enum(['kg', 'lb']),
});

/** `POST /api/v1/ai/program-from-text` (I10): a draft for the import review. */
export const aiProgramFromTextRoute: RouteDef<typeof fromTextSchema, true> = {
  can: 'program:write',
  input: fromTextSchema,
  rateLimit: { capacity: 5, refillPerSecond: 5 / 60 },
  handler: async ({ actor, input, tenant }) => {
    const p = port();
    const { library, clientNames } = await tenant(async (tx) => ({
      library: await exerciseLibraryNames(tx, actor),
      clientNames: await clientNamesForRedaction(tx),
    }));
    return run(
      tenant,
      actor,
      'program_from_text',
      input.text.length,
      () => draftProgramFromText(p, { ...input, library, clientNames }),
      (r) => r.text.length,
    );
  },
};

const fromTemplateSchema = z.object({
  templateId: z.string().max(64),
  request: z.string().max(500),
  units: z.enum(['kg', 'lb']),
});

/** `POST /api/v1/ai/program-from-template` (I11): a draft for the import review. */
export const aiProgramFromTemplateRoute: RouteDef<typeof fromTemplateSchema, true> = {
  can: 'program:write',
  input: fromTemplateSchema,
  rateLimit: { capacity: 5, refillPerSecond: 5 / 60 },
  handler: async ({ actor, input, tenant }) => {
    const p = port();
    const { req, redactions } = await tenant(async (tx) =>
      templateDraftRequest(tx, actor, { ...input, library: await exerciseLibraryNames(tx, actor) }),
    );
    const draft = await run(
      tenant,
      actor,
      'program_from_template',
      req.prompt.length,
      () => completeProgramDraft(p, req, input.units),
      (r) => r.text.length,
    );
    return { ...draft, redactions };
  },
};

/** `POST /api/v1/ai/checkins/:id/highlights` (I12): points linked to their answers; never stored. */
export const aiCheckinHighlightsRoute: RouteDef<undefined, true> = {
  can: 'checkin:read',
  rateLimit: { capacity: 10, refillPerSecond: 10 / 60 },
  handler: async ({ actor, params, tenant }) => {
    const p = port();
    const prepared = await tenant((tx) => highlightsRequest(tx, actor, params.id ?? ''));
    return run(
      tenant,
      actor,
      'checkin_highlights',
      prepared.req.prompt.length,
      () => completeHighlights(p, prepared),
      (r) => r.points.reduce((n, x) => n + x.text.length, 0),
    );
  },
};
