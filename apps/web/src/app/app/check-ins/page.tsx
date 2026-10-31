import type { Metadata } from 'next';
import { getCheckinTemplate } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { TemplateEditor } from './TemplateEditor';

export const metadata: Metadata = { title: 'Check-in questions | Kinetic' };

export default async function CheckinTemplatePage() {
  const template = await withServerTenant((tx, actor) => getCheckinTemplate(tx, actor));
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Check-in questions</h1>
      <p className="mb-6 text-secondary">
        One weekly check-in for all your clients. Changes apply to check-ins sent from now on.
      </p>
      <TemplateEditor key={template.updatedAt} template={template} />
    </>
  );
}
