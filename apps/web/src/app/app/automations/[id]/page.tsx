import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  isUuid,
  listCheckinTemplates,
  listCourses,
  listSequences,
  listTags,
  SEQUENCE_TEMPLATES,
} from '@kinetic/core';
import { loadAllTemplates } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { ArchiveSequence } from '../ArchiveSequence';
import { SequenceEditor } from '../SequenceEditor';

export const metadata: Metadata = { title: 'Automation | Repsy' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** PRD J1-J3: edit an automation (`new`, optionally from a starter template). */
export default async function AutomationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const key = first((await searchParams).template);
  const template = SEQUENCE_TEMPLATES.find((t) => t.key === key);
  if (id !== 'new' && !isUuid(id)) notFound();
  const data = await withServerTenant(async (tx, actor) => ({
    sequence:
      id === 'new' ? null : ((await listSequences(tx, actor)).find((s) => s.id === id) ?? null),
    options: {
      tags: (await listTags(tx, actor)).map((t) => ({ id: t.id, name: t.name })),
      forms: (await listCheckinTemplates(tx, actor))
        .filter((t) => t.kind !== 'checkin')
        .map((t) => ({ id: t.id, title: t.title })),
      programs: (await loadAllTemplates(tx, actor)).items
        .filter((p) => p.versionNo !== null)
        .map((p) => ({ id: p.id, title: p.title })),
      courses: (await listCourses(tx, actor)).map((c) => ({ id: c.id, title: c.title })),
    },
  }));
  if (id !== 'new' && !data.sequence) notFound();
  const s = data.sequence;
  const initial = s
    ? {
        name: s.name,
        trigger: s.trigger,
        triggerValue: s.triggerValue,
        active: s.active,
        steps: s.steps,
      }
    : {
        name: template?.name ?? '',
        trigger: template?.trigger ?? 'manual',
        triggerValue: null,
        active: true,
        steps: template?.steps ?? [],
      };
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold md:text-display">{s ? s.name : 'New automation'}</h1>
        {s && <ArchiveSequence id={s.id} name={s.name} />}
      </div>
      <SequenceEditor id={s?.id ?? null} initial={initial} options={data.options} />
    </>
  );
}
