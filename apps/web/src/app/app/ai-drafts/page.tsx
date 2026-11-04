import type { Metadata } from 'next';
import {
  getAiSetting,
  listAiDrafts,
  listPrograms,
  MANAGER_ROLES,
  TRAINER_ROLES,
} from '@kinetic/core';
import { AiDraftsClient } from '@/components/ai/AiDraftsClient';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'AI drafts | Repsy' };

// NOTE (merge step): the ai/* functions above are not exported from `@kinetic/core` yet. Add the
// export block from SLICE_REPORT_AI.md to `packages/core/src/index.ts` before running this page.

/** PRD I10, I11, I12, I14: coach-only AI drafting, per-workspace opt-in, always a draft. */
export default async function AiDraftsPage() {
  const { setting, canManageSetting, canDraft, drafts, templates } = await withServerTenant(
    async (tx, actor) => {
      const setting = await getAiSetting(tx, actor);
      const canDraft = (TRAINER_ROLES as readonly string[]).includes(actor.role);
      const drafts = setting.aiEnabled && canDraft ? await listAiDrafts(tx, actor) : [];
      const templates = canDraft
        ? (await listPrograms(tx, actor, { kind: 'template' })).items.map((t) => ({
            id: t.id,
            title: t.title,
          }))
        : [];
      return {
        setting,
        canManageSetting: (MANAGER_ROLES as readonly string[]).includes(actor.role),
        canDraft,
        drafts: drafts.map((d) => ({
          id: d.id,
          kind: d.kind,
          title: d.content.title,
          weeks: d.content.weeks,
          unmatched: d.content.unmatched,
          createdAt: d.createdAt,
        })),
        templates,
      };
    },
  );
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">AI drafts</h1>
      <AiDraftsClient
        aiEnabled={setting.aiEnabled}
        canManageSetting={canManageSetting}
        canDraft={canDraft}
        drafts={drafts}
        templates={templates}
      />
    </>
  );
}
