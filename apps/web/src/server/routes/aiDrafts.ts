import { z } from 'zod';
import {
  DomainError,
  FakeAiProvider,
  getAiSetting,
  getCheckin,
  getProgram,
  highlightsForCoach,
  listAiDrafts,
  savePasteAiDraft,
  saveTemplateAiDraft,
  searchExercises,
  setAiSetting,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// NOTE (merge step): the ai/* functions above are not exported from `@kinetic/core` yet. Add the
// export block from SLICE_REPORT_AI.md to `packages/core/src/index.ts` before running this route.

const draftSchema = z.object({
  kind: z.enum(['paste', 'template']),
  sourceText: z.string().max(100_000).optional(),
  instruction: z.string().max(2000).optional(),
  templateProgramId: z.string().max(64).optional(),
  title: z.string().max(120).optional(),
  equipmentFilter: z.array(z.string().max(40)).max(20).optional(),
});

/** `POST /api/v1/ai-drafts` (PRD I10, I11). Coach-only, opt-in-gated, draft-only (see core). */
export const aiDraftsPostRoute: RouteDef<typeof draftSchema, true> = {
  can: 'program:write',
  input: draftSchema,
  handler: async ({ actor, input, tenant }) => {
    const provider = new FakeAiProvider();
    const view = await tenant(async (tx) => {
      if (input.kind === 'paste') {
        if (!input.sourceText) {
          throw new DomainError('VALIDATION', 'Paste a program first.');
        }
        const library: { id: string; name: string; equipment: string }[] = [];
        let cursor: string | undefined;
        do {
          const page = await searchExercises(tx, actor, cursor ? { cursor } : {});
          library.push(
            ...page.items.map((e) => ({ id: e.id, name: e.name, equipment: e.equipment })),
          );
          cursor = page.nextCursor ?? undefined;
        } while (cursor && library.length < 2000);
        return savePasteAiDraft(tx, actor, provider, {
          sourceText: input.sourceText,
          title: input.title,
          library,
          equipmentFilter: input.equipmentFilter,
        });
      }
      if (!input.instruction || !input.templateProgramId) {
        throw new DomainError('VALIDATION', 'Pick a template and describe the draft you want.');
      }
      const template = await getProgram(tx, actor, input.templateProgramId);
      const firstWeek = template.weeks[0] as unknown as
        | {
            days: {
              title: string;
              exercises: {
                exerciseId: string;
                exerciseName: string;
                sets: {
                  reps?: number;
                  repsMax?: number;
                  loadKg?: number;
                  rpe?: number;
                  durationSec?: number;
                  distanceM?: number;
                }[];
              }[];
            }[];
          }
        | undefined;
      if (!firstWeek) {
        throw new DomainError('VALIDATION', 'That template has no days to copy.');
      }
      const ids = [...new Set(firstWeek.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
      const exerciseRows = (await tx.exercise.findMany({
        where: { id: { in: ids } },
        select: { id: true, equipment: true },
      })) as unknown as { id: string; equipment: string }[];
      const equipmentById = new Map(exerciseRows.map((e) => [e.id, e.equipment]));
      return saveTemplateAiDraft(tx, actor, provider, {
        instruction: input.instruction,
        title: input.title,
        templateDays: firstWeek.days.map((d) => ({
          title: d.title,
          exercises: d.exercises.map((e) => {
            const eq = equipmentById.get(e.exerciseId);
            return {
              exerciseId: e.exerciseId,
              name: e.exerciseName,
              ...(typeof eq === 'string' ? { equipment: eq } : {}),
              sets: e.sets.map((s) => ({
                reps: s.reps,
                repsMax: s.repsMax,
                loadKg: s.loadKg,
                rpe: s.rpe,
                durationSec: s.durationSec,
                distanceM: s.distanceM,
              })),
            };
          }),
        })),
      });
    });
    return new ApiResult(view, { status: 201 });
  },
};

/** `GET /api/v1/ai-drafts` (PRD I10, I11): the workspace's AI drafts, newest first. */
export const aiDraftsGetRoute: RouteDef<undefined, true> = {
  can: 'program:write',
  handler: ({ actor, tenant }) => tenant((tx) => listAiDrafts(tx, actor)),
};

const settingSchema = z.object({ aiEnabled: z.boolean() });

/** `PUT /api/v1/ai-settings`: the per-workspace AI opt-in (I14). Managers only. */
export const aiSettingPutRoute: RouteDef<typeof settingSchema, true> = {
  can: 'settings:org:update',
  input: settingSchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => setAiSetting(tx, actor, input.aiEnabled)),
};

/** `GET /api/v1/ai-settings`: the workspace's AI opt-in flag (off by default). */
export const aiSettingGetRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: ({ actor, tenant }) => tenant((tx) => getAiSetting(tx, actor)),
};

const highlightsSchema = z.object({
  clientId: z.string().min(1).max(64),
  previousId: z.string().min(1).max(64),
  currentId: z.string().min(1).max(64),
});

/**
 * `GET /api/v1/ai-drafts/highlights` (PRD I12): what changed between two submitted check-ins, with
 * a link to every source answer. Computed locally in core; no provider call, no client data sent.
 */
export const aiDraftHighlightsRoute: RouteDef<typeof highlightsSchema, true> = {
  can: 'checkin:read',
  input: highlightsSchema,
  handler: ({ actor, input, tenant }) =>
    tenant(async (tx) => {
      const previous = await getCheckin(tx, actor, input.previousId);
      const current = await getCheckin(tx, actor, input.currentId);
      if (previous.clientId !== input.clientId || current.clientId !== input.clientId) {
        throw new DomainError('NOT_FOUND', 'Not found.');
      }
      return highlightsForCoach(actor, {
        clientId: input.clientId,
        questions: current.questions,
        previous: { checkinId: previous.id, answers: previous.answers },
        current: { checkinId: current.id, answers: current.answers },
      });
    }),
};
