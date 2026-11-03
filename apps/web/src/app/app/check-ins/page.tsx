import type { Metadata } from 'next';
import Link from 'next/link';
import { listCheckinTemplates, type TemplateKind } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { cn } from '@/lib/utils';
import { NewTemplateForm } from './NewTemplateForm';
import { TemplateEditor } from './TemplateEditor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Check-in questions | Repsy' };

const KIND_LABEL: Record<TemplateKind, string> = {
  checkin: 'Recurring check-in',
  form: 'One-off form',
  intake: 'Intake form',
};

/** PRD F2: the form library (recurring check-ins, one-off forms, intake forms) and the editor for one of them. */
export default async function CheckinTemplatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const wanted = Array.isArray(sp.template) ? sp.template[0] : sp.template;
  const templates = await withServerTenant((tx, actor) => listCheckinTemplates(tx, actor));
  const selected = templates.find((t) => t.id === wanted) ?? templates[0]!;
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Check-in questions</h1>
      <p className="mb-6 text-secondary">
        Recurring check-ins go out on each client&apos;s day; one-off and intake forms are sent when
        you choose. Changes apply to what you send from now on.
      </p>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <nav aria-label="Forms and check-ins">
            <ul className="flex flex-col gap-1">
              {templates.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/app/check-ins?template=${t.id}`}
                    aria-current={t.id === selected.id ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 flex-col justify-center rounded-control px-3 py-1',
                      t.id === selected.id ? 'bg-surface shadow-card' : 'hover:bg-surface',
                    )}
                  >
                    <span className="font-medium break-words">{t.title}</span>
                    <span className="text-sm text-secondary">
                      {KIND_LABEL[t.kind]}
                      {t.isDefault && ' · default'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <NewTemplateForm />
        </div>
        <div>
          <p className="mb-4 text-sm text-secondary">
            {KIND_LABEL[selected.kind]}
            {selected.isDefault && ' · sent to every client without their own check-in'}
          </p>
          <TemplateEditor key={`${selected.id}:${selected.updatedAt}`} template={selected} />
        </div>
      </div>
    </>
  );
}
